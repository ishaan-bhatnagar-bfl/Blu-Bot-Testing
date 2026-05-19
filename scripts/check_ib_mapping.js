const XLSX = require('xlsx');
const wb = XLSX.readFile(process.env.HOME + '/Desktop/dlp_temp/Chat_dump_L0_L1_L2_Mapped_V13.xlsx');
const ws = wb.Sheets[wb.SheetNames[1]];
const data = XLSX.utils.sheet_to_json(ws, { header: 1 }).slice(1);

// Columns: A=question, B=L0, C=L1, D=L2, E=L0-IB, F=L1-IB, G=L2-IB
let ibMapped = 0, ibEmpty = 0;
const ibL1s = new Set(), ibL2s = new Set();
const samples = [];

data.forEach(r => {
  const l0ib = (r[4] || '').trim();
  const l1ib = (r[5] || '').trim();
  const l2ib = (r[6] || '').trim();
  if (!l1ib) { ibEmpty++; return; }
  ibMapped++;
  ibL1s.add(l1ib);
  if (l2ib) ibL2s.add(l2ib);
  if (samples.length < 10) samples.push({ q: String(r[0]).slice(0,60), l0: l0ib, l1: l1ib, l2: l2ib });
});

console.log('IB mapped rows:', ibMapped);
console.log('IB empty rows:', ibEmpty);
console.log('\nUnique L1-IB (' + ibL1s.size + '):');
[...ibL1s].sort().forEach(v => console.log('  ' + v));
console.log('\nUnique L2-IB (' + ibL2s.size + '):');
[...ibL2s].sort().forEach(v => console.log('  ' + v));
console.log('\nSample rows:');
samples.forEach(s => console.log('  Q:', s.q, '\n  L1:', s.l1, '| L2:', s.l2, '\n'));
