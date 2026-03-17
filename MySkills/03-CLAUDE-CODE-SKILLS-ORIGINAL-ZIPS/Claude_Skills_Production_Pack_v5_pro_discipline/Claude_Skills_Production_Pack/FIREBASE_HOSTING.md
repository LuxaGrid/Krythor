# Firebase Hosting Notes (Pages-first)

This pack does NOT assume your exact Next build output.
Common approaches:
- Static export (next export) to a `public/`-like folder
- A framework adapter / hosting setup

What you should do:
1) Decide how you deploy Next.js on Firebase Hosting for THIS repo.
2) Update firebase.json:
   - hosting.public (your output dir)
   - rewrites for SPA routes (if needed)
3) Keep headers in firebase.json (use /40-headers-hardening-firebase).

Common gotcha:
- Client-side routing fails on refresh without rewrites.
