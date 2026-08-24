"""
Train the U-Net flood surrogate on the SWE-generated dataset and evaluate on
the held-out validation split (runs never seen during training).

Usage: .venv\\Scripts\\python.exe backend\\ml\\train.py --epochs 150
"""
import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
import torch
from torch.utils.data import DataLoader

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from ml import config as cfg
from ml.dataset import FloodDataset
from ml.model import FloodUNet

FLOOD_THRESHOLD_M = cfg.FLOOD_DEPTH_THRESHOLD_M


def weighted_mse(pred, target, wet_weight=6.0):
    wet_mask = (target >= FLOOD_THRESHOLD_M).float()
    weight = 1.0 + wet_weight * wet_mask
    return (weight * (pred - target) ** 2).mean()


@torch.no_grad()
def evaluate(model, loader, device):
    model.eval()
    ious, depth_errs, mse_losses = [], [], []
    per_sample = []
    for x, y in loader:
        x, y = x.to(device), y.to(device)
        pred = model(x)
        mse_losses.append(weighted_mse(pred, y).item())

        pred_np, y_np = pred.cpu().numpy(), y.cpu().numpy()
        for p, t in zip(pred_np, y_np):
            p_wet = p >= FLOOD_THRESHOLD_M
            t_wet = t >= FLOOD_THRESHOLD_M
            inter = np.logical_and(p_wet, t_wet).sum()
            union = np.logical_or(p_wet, t_wet).sum()
            iou = inter / union if union > 0 else (1.0 if not p_wet.any() else 0.0)
            rmse = np.sqrt(np.mean((p - t) ** 2))
            wet_rmse = np.sqrt(np.mean((p[t_wet] - t[t_wet]) ** 2)) if t_wet.any() else float("nan")
            ious.append(iou)
            depth_errs.append(rmse)
            per_sample.append(dict(iou=float(iou), rmse_m=float(rmse), wet_rmse_m=float(wet_rmse)))
    return dict(
        mean_iou=float(np.mean(ious)),
        min_iou=float(np.min(ious)),
        mean_rmse_m=float(np.mean(depth_errs)),
        mean_val_loss=float(np.mean(mse_losses)),
        per_sample=per_sample,
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=int, default=150)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--batch-size", type=int, default=8)
    args = ap.parse_args()

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"device: {device}")

    train_ds = FloodDataset("train")
    val_ds = FloodDataset("val")
    print(f"train samples: {len(train_ds)}, val samples: {len(val_ds)}")
    train_loader = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True)
    val_loader = DataLoader(val_ds, batch_size=args.batch_size, shuffle=False)

    model = FloodUNet(in_ch=3, base=24).to(device)
    opt = torch.optim.Adam(model.parameters(), lr=args.lr, weight_decay=1e-5)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=args.epochs)

    history = []
    best_val_loss = float("inf")
    t0 = time.time()
    for epoch in range(args.epochs):
        model.train()
        train_losses = []
        for x, y in train_loader:
            x, y = x.to(device), y.to(device)
            opt.zero_grad()
            pred = model(x)
            loss = weighted_mse(pred, y)
            loss.backward()
            opt.step()
            train_losses.append(loss.item())
        sched.step()

        val_metrics = evaluate(model, val_loader, device)
        train_loss = float(np.mean(train_losses))
        history.append(dict(epoch=epoch, train_loss=train_loss, val_loss=val_metrics["mean_val_loss"],
                             val_mean_iou=val_metrics["mean_iou"], val_rmse_m=val_metrics["mean_rmse_m"]))

        if val_metrics["mean_val_loss"] < best_val_loss:
            best_val_loss = val_metrics["mean_val_loss"]
            cfg.ML_CHECKPOINT_DIR.mkdir(parents=True, exist_ok=True)
            torch.save(model.state_dict(), cfg.ML_CHECKPOINT_DIR / "flood_unet_best.pt")

        if epoch % 10 == 0 or epoch == args.epochs - 1:
            print(f"epoch {epoch:3d}  train_loss={train_loss:.4f}  val_loss={val_metrics['mean_val_loss']:.4f}  "
                  f"val_IoU={val_metrics['mean_iou']:.3f}  val_RMSE={val_metrics['mean_rmse_m']:.3f}m")

    total_s = time.time() - t0

    model.load_state_dict(torch.load(cfg.ML_CHECKPOINT_DIR / "flood_unet_best.pt"))
    final_val = evaluate(model, val_loader, device)

    report = dict(
        device=str(device),
        epochs=args.epochs,
        lr=args.lr,
        batch_size=args.batch_size,
        n_train=len(train_ds),
        n_val=len(val_ds),
        train_wall_s=round(total_s, 1),
        best_val_loss=best_val_loss,
        final_val_metrics={k: v for k, v in final_val.items() if k != "per_sample"},
        per_sample_val_metrics=final_val["per_sample"],
        history=history,
        caveats=[
            f"Trained on only {len(train_ds)} SWE runs -- a small dataset for a CNN/U-Net trained "
            "from scratch. Validation metrics below are honest but should be read as indicative, "
            "not a rigorous generalization guarantee; expect degraded accuracy for breach parameter "
            "combinations far from the sampled ranges (discharge outside "
            f"{cfg.DISCHARGE_RANGE_CUMECS}, or locations beyond +/-{cfg.LOCATION_JITTER_CELLS} cells "
            "from the documented breach site).",
            "Per-sample validation metrics are included below (not just the mean) so any "
            "poorly-predicted held-out scenarios are visible, not averaged away.",
        ],
    )
    (cfg.ML_CHECKPOINT_DIR / "training_report.json").write_text(json.dumps(report, indent=2))

    print(f"\nTraining done in {total_s/60:.1f} min. Best val_loss={best_val_loss:.4f}")
    print(f"Final held-out validation: mean IoU={final_val['mean_iou']:.3f} (min={final_val['min_iou']:.3f}), "
          f"mean depth RMSE={final_val['mean_rmse_m']:.3f}m")
    worst = sorted(final_val["per_sample"], key=lambda s: s["iou"])[:3]
    print("Worst 3 held-out samples by IoU:")
    for w in worst:
        print(f"  {w}")
    print(f"\nModel: {cfg.ML_CHECKPOINT_DIR / 'flood_unet_best.pt'}")
    print(f"Report: {cfg.ML_CHECKPOINT_DIR / 'training_report.json'}")


if __name__ == "__main__":
    main()
