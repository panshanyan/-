u=open('ui2.html').read()
for tag,f in [('/*DECODER*/','decoder.js'),('/*CSV*/','csv.js'),('/*ANALYSIS*/','analysis.js'),('/*ANALYSIS2*/','analysis2.js'),('/*PANELS*/','panels.js'),('/*UNZIP*/','unzip.js')]:
    u=u.replace(tag,open(f).read())
open('../app/src/main/assets/index.html','w').write(u); print(len(u))
