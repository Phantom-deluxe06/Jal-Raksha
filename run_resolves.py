import subprocess

# modify resolve_app.py to use CRLF and optional newline regex
with open('resolve_app.py', 'r', encoding='utf-8') as f:
    c = f.read()
c = c.replace(r'<<<<<<< HEAD\r?\n(.*?)\r?\n=======\r?\n(.*?)\r?\n>>>>>>> [a-f0-9]+(?:\r?\n|$)', r'<<<<<<< HEAD\r?\n(.*?)\r?\n?=======\r?\n(.*?)\r?\n?>>>>>>> [a-f0-9]+(?:\r?\n|$)')
with open('resolve_app.py', 'w', encoding='utf-8') as f:
    f.write(c)

print("Running resolve_conflicts.py...")
subprocess.run(['python', 'resolve_conflicts.py'])
print("Running resolve_app.py...")
subprocess.run(['python', 'resolve_app.py'])
