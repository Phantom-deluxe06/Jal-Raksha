import re

def resolve_all_incoming(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
        
    pattern = re.compile(r'<<<<<<< HEAD\r?\n(.*?)\r?\n?=======\r?\n(.*?)\r?\n?>>>>>>> [a-f0-9]+(?:\r?\n|$)', re.DOTALL)
    
    def replacer(match):
        return match.group(2)
        
    resolved_content = pattern.sub(replacer, content)
    
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(resolved_content)

resolve_all_incoming('frontend/src/components/CesiumViewer.jsx')
resolve_all_incoming('frontend/src/App.css')
resolve_all_incoming('frontend/src/components/InfoPanel.jsx')

def manual_resolve(filepath, choices):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    parts = []
    last_end = 0
    pattern = re.compile(r'<<<<<<< HEAD\r?\n(.*?)\r?\n?=======\r?\n(.*?)\r?\n?>>>>>>> [a-f0-9]+(?:\r?\n|$)', re.DOTALL)
    
    matches = list(pattern.finditer(content))
    if len(matches) != len(choices):
        print(f"Error: {filepath} has {len(matches)} conflicts, but {len(choices)} choices provided.")
        return
        
    for i, match in enumerate(matches):
        parts.append(content[last_end:match.start()])
        head = match.group(1)
        incoming = match.group(2)
        choice = choices[i]
        
        if choice == 'head':
            parts.append(head)
        elif choice == 'incoming':
            parts.append(incoming)
        elif callable(choice):
            parts.append(choice(head, incoming))
        else:
            parts.append(choice)
            
        last_end = match.end()
        
    parts.append(content[last_end:])
    
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write("".join(parts))

def api_c1(h, i):
    return """export async function queryPointDepth(lat, lon, jobId = DEFAULT_JOB_ID, threshold = 0.1) {
  const res = await fetch(`${API_BASE}/simulate/query-point/${jobId}?lat=${lat}&lon=${lon}&threshold=${threshold}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `point query failed: ${res.status}`);
  }
  return res.json();
}

export async function fetchSarComparison(jobId = DEFAULT_JOB_ID, options = {}) {
  const payload = {
    job_id: jobId,
    frame_index: options.frame_index ?? null,
    start_date: options.start_date || null,
    end_date: options.end_date || null,
    orbit_pass: options.orbit_pass || null,
    threshold_db: options.threshold_db ?? -17.0,
  };

  const res = await fetch(`${API_BASE}/realtime/compare`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `SAR comparison failed: ${res.status}`);
  }
  return res.json();
}"""
manual_resolve('frontend/src/api.js', [api_c1])
