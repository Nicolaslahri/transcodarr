"use strict";(self.webpackChunk_N_E=self.webpackChunk_N_E||[]).push([[497],{6497:function(e,t,s){s.r(t),s.d(t,{default:function(){return m}});var r=s(7437),a=s(725),l=s(2265),n=s(4268),i=s(2107),d=s(9089),c=s(5532),x=s(6462),o=s(166),u=s(5902);/**
 * @license lucide-react v0.400.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */let h=(0,s(1827).Z)("Clock",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["polyline",{points:"12 6 12 12 16 14",key:"68esgv"}]]);function m(){let{stats:e,connected:t,meta:s,jobs:m,workers:f}=(0,a.m)(),y=(0,l.useRef)(null);(0,l.useEffect)(()=>{let e=n.ZP.context(()=>{n.ZP.from(".stat-card",{y:20,opacity:0,duration:.7,stagger:.08,ease:"power3.out"}),n.ZP.utils.toArray(".stat-value").forEach(e=>{let t=parseFloat(e.dataset.value||"0");n.ZP.fromTo(e,{innerText:"0"},{duration:1.4,ease:"power2.out",onUpdate(){let s=t*this.progress();e.innerText=t%1!=0?s.toFixed(1):Math.round(s).toString()},onComplete(){e.innerText=t%1!=0?t.toFixed(1):t.toString()}})})},y);return()=>e.revert()},[e]);let b=m.slice(0,5);return(0,r.jsxs)("div",{ref:y,className:"p-10 max-w-7xl mx-auto space-y-10",children:[(0,r.jsxs)("header",{className:"flex justify-between items-end",children:[(0,r.jsxs)("div",{children:[(0,r.jsx)("h1",{className:"text-4xl font-bold tracking-tight text-white mb-1",children:"Overview"}),(0,r.jsx)("p",{className:"text-textMuted",children:"Monitor your fleet and transcoding queue."})]}),(0,r.jsxs)("div",{className:"flex items-center gap-2 mb-1",children:[(0,r.jsx)("span",{className:"w-2.5 h-2.5 rounded-full ".concat(t?"bg-green-400 animate-pulse":"bg-red-500")}),(0,r.jsx)("span",{className:"text-sm text-textMuted",children:t?"Live":"Offline"})]})]}),(0,r.jsxs)("div",{className:"grid grid-cols-2 lg:grid-cols-4 gap-5",children:[(0,r.jsx)(p,{icon:(0,r.jsx)(i.Z,{className:"text-primary w-5 h-5"}),label:"Jobs Today",value:e.jobsToday,suffix:""}),(0,r.jsx)(p,{icon:(0,r.jsx)(d.Z,{className:"text-green-400 w-5 h-5"}),label:"Space Saved",value:e.gbSaved,suffix:" GB"}),(0,r.jsx)(p,{icon:(0,r.jsx)(c.Z,{className:"text-purple-400 w-5 h-5"}),label:"Workers Online",value:e.workersOnline,suffix:""}),(0,r.jsx)(p,{icon:(0,r.jsx)(x.Z,{className:"text-yellow-400 w-5 h-5"}),label:"Active Jobs",value:e.activeJobs,suffix:""})]}),(0,r.jsxs)("div",{className:"grid grid-cols-1 lg:grid-cols-2 gap-6",children:[(0,r.jsxs)("div",{className:"bg-surface border border-border rounded-2xl overflow-hidden",children:[(0,r.jsxs)("div",{className:"px-6 py-4 border-b border-border flex items-center justify-between",children:[(0,r.jsx)("h2",{className:"font-bold text-white text-sm",children:"Recent Activity"}),(0,r.jsxs)("a",{href:"/queue",className:"flex items-center gap-1 text-xs text-textMuted hover:text-primary transition-colors",children:["View all ",(0,r.jsx)(o.Z,{className:"w-3 h-3"})]})]}),(0,r.jsxs)("div",{className:"divide-y divide-border",children:[0===b.length&&(0,r.jsx)("div",{className:"px-6 py-8 text-center text-textMuted text-sm",children:"No recent jobs"}),b.map(e=>(0,r.jsxs)("div",{className:"px-6 py-3.5 flex items-center gap-4",children:["complete"===e.status?(0,r.jsx)(u.Z,{className:"w-4 h-4 text-green-500 shrink-0"}):"transcoding"===e.status?(0,r.jsx)(x.Z,{className:"w-4 h-4 text-primary shrink-0 animate-pulse"}):(0,r.jsx)(h,{className:"w-4 h-4 text-textMuted shrink-0"}),(0,r.jsx)("span",{className:"flex-1 text-sm text-white truncate",children:e.fileName}),(0,r.jsx)("span",{className:"text-xs font-medium ".concat("complete"===e.status?"text-green-400":"failed"===e.status?"text-red-400":"text-textMuted"),children:e.status})]},e.id))]})]}),(0,r.jsxs)("div",{className:"bg-surface border border-border rounded-2xl overflow-hidden",children:[(0,r.jsxs)("div",{className:"px-6 py-4 border-b border-border flex items-center justify-between",children:[(0,r.jsx)("h2",{className:"font-bold text-white text-sm",children:"Fleet"}),(0,r.jsxs)("a",{href:"/workers",className:"flex items-center gap-1 text-xs text-textMuted hover:text-primary transition-colors",children:["Manage ",(0,r.jsx)(o.Z,{className:"w-3 h-3"})]})]}),(0,r.jsxs)("div",{className:"divide-y divide-border",children:[0===f.length&&(0,r.jsx)("div",{className:"px-6 py-8 text-center text-textMuted text-sm",children:"No workers discovered yet"}),f.map(e=>(0,r.jsxs)("div",{className:"px-6 py-3.5 flex items-center gap-4",children:[(0,r.jsx)("div",{className:"w-2 h-2 rounded-full shrink-0 ".concat("active"===e.status?"bg-primary animate-pulse":"idle"===e.status?"bg-green-400":"pending"===e.status?"bg-yellow-400":"bg-red-400")}),(0,r.jsxs)("div",{className:"flex-1 min-w-0",children:[(0,r.jsx)("p",{className:"text-sm text-white font-medium",children:e.name}),(0,r.jsx)("p",{className:"text-xs text-textMuted",children:e.hardware.gpuName})]}),(0,r.jsx)("span",{className:"text-xs text-textMuted",children:e.status.toUpperCase()})]},e.id))]})]})]})]})}function p(e){let{icon:t,label:s,value:a,suffix:l}=e;return(0,r.jsxs)("div",{className:"stat-card bg-surface border border-border rounded-2xl p-5 flex items-start gap-4 hover:border-border/60 transition-colors",children:[(0,r.jsx)("div",{className:"p-2.5 bg-background rounded-xl border border-border/50 shrink-0",children:t}),(0,r.jsxs)("div",{children:[(0,r.jsx)("p",{className:"text-xs text-textMuted font-medium mb-1",children:s}),(0,r.jsxs)("p",{className:"text-3xl font-bold text-white flex items-baseline gap-1",children:[(0,r.jsx)("span",{className:"stat-value","data-value":a,children:a}),l&&(0,r.jsx)("span",{className:"text-base text-textMuted font-normal",children:l})]})]})]})}},1827:function(e,t,s){s.d(t,{Z:function(){return d}});var r=s(2265);/**
 * @license lucide-react v0.400.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */let a=e=>e.replace(/([a-z0-9])([A-Z])/g,"$1-$2").toLowerCase(),l=function(){for(var e=arguments.length,t=Array(e),s=0;s<e;s++)t[s]=arguments[s];return t.filter((e,t,s)=>!!e&&s.indexOf(e)===t).join(" ")};/**
 * @license lucide-react v0.400.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */var n={xmlns:"http://www.w3.org/2000/svg",width:24,height:24,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:2,strokeLinecap:"round",strokeLinejoin:"round"};/**
 * @license lucide-react v0.400.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */let i=(0,r.forwardRef)((e,t)=>{let{color:s="currentColor",size:a=24,strokeWidth:i=2,absoluteStrokeWidth:d,className:c="",children:x,iconNode:o,...u}=e;return(0,r.createElement)("svg",{ref:t,...n,width:a,height:a,stroke:s,strokeWidth:d?24*Number(i)/Number(a):i,className:l("lucide",c),...u},[...o.map(e=>{let[t,s]=e;return(0,r.createElement)(t,s)}),...Array.isArray(x)?x:[x]])}),d=(e,t)=>{let s=(0,r.forwardRef)((s,n)=>{let{className:d,...c}=s;return(0,r.createElement)(i,{ref:n,iconNode:t,className:l("lucide-".concat(a(e)),d),...c})});return s.displayName="".concat(e),s}},2107:function(e,t,s){s.d(t,{Z:function(){return r}});/**
 * @license lucide-react v0.400.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */let r=(0,s(1827).Z)("Activity",[["path",{d:"M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2",key:"169zse"}]])},166:function(e,t,s){s.d(t,{Z:function(){return r}});/**
 * @license lucide-react v0.400.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */let r=(0,s(1827).Z)("ArrowRight",[["path",{d:"M5 12h14",key:"1ays0h"}],["path",{d:"m12 5 7 7-7 7",key:"xquz4c"}]])},5902:function(e,t,s){s.d(t,{Z:function(){return r}});/**
 * @license lucide-react v0.400.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */let r=(0,s(1827).Z)("CircleCheck",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"m9 12 2 2 4-4",key:"dzmm74"}]])},5532:function(e,t,s){s.d(t,{Z:function(){return r}});/**
 * @license lucide-react v0.400.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */let r=(0,s(1827).Z)("Cpu",[["rect",{width:"16",height:"16",x:"4",y:"4",rx:"2",key:"14l7u7"}],["rect",{width:"6",height:"6",x:"9",y:"9",rx:"1",key:"5aljv4"}],["path",{d:"M15 2v2",key:"13l42r"}],["path",{d:"M15 20v2",key:"15mkzm"}],["path",{d:"M2 15h2",key:"1gxd5l"}],["path",{d:"M2 9h2",key:"1bbxkp"}],["path",{d:"M20 15h2",key:"19e6y8"}],["path",{d:"M20 9h2",key:"19tzq7"}],["path",{d:"M9 2v2",key:"165o2o"}],["path",{d:"M9 20v2",key:"i2bqo8"}]])},9089:function(e,t,s){s.d(t,{Z:function(){return r}});/**
 * @license lucide-react v0.400.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */let r=(0,s(1827).Z)("HardDrive",[["line",{x1:"22",x2:"2",y1:"12",y2:"12",key:"1y58io"}],["path",{d:"M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z",key:"oot6mr"}],["line",{x1:"6",x2:"6.01",y1:"16",y2:"16",key:"sgf278"}],["line",{x1:"10",x2:"10.01",y1:"16",y2:"16",key:"1l4acy"}]])},6462:function(e,t,s){s.d(t,{Z:function(){return r}});/**
 * @license lucide-react v0.400.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */let r=(0,s(1827).Z)("Zap",[["path",{d:"M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z",key:"1xq2db"}]])}}]);