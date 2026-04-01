import re
f = open(r'C:\Projects\btkkviz\src\app\page.tsx', encoding='utf-8')
c = f.read()
f.close()

# Fix share button class
c = c.replace('absolute top-2 right-2 bg-purple-600 hover:bg-purple-700 text-white px-2 py-1 rounded-lg shadow text-xs transition-all duration-300 flex items-center gap-1', 'absolute top-2 right-2 bg-purple-600 hover:bg-purple-700 text-white px-3 py-1.5 rounded-lg shadow text-xs font-bold transition-all duration-300')

# Remove SVG using regex, replace with text
c = re.sub(r'<svg[^>]*className="h-3 w-3"[^/]*/svg>', 'Megosztás', c, flags=re.DOTALL)

# Bigger criminal name
c = c.replace('text-lg font-extrabold mt-2 text-yellow-400 drop-shadow-lg', 'text-3xl font-extrabold mt-2 text-yellow-400 drop-shadow-lg')

open(r'C:\Projects\btkkviz\src\app\page.tsx', 'w', encoding='utf-8').write(c)
print('done')
