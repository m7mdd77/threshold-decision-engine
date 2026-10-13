import type { ReactNode } from 'react';
export const metadata={title:'Threshold — The Decision Engine',description:'Explainable agent decisions with evidence, scoped operator review, rechecked execution, and sandbox receipts.'};
export default function Layout({children}:{children:ReactNode}){return <html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"/><link rel="stylesheet" href="/style.css"/></head><body>{children}<script type="module" src="/app.js"/></body></html>;}
