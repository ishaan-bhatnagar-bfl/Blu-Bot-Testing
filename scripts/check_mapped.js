const XLSX = require('xlsx');
const dir = process.env.HOME + '/Desktop/dlp_temp';
const wb = XLSX.readFile(dir + '/Chat_dump_L0_L1_L2_Mapped_V13.xlsx');
const ws = wb.Sheets[wb.SheetNames[1]];
const data = XLSX.utils.sheet_to_json(ws, { header: 1 }).slice(1);

const l0s = new Set(), l1s = new Set(), l2s = new Set();
let mapped = 0, unclear = 0, empty = 0;

data.forEach(r => {
  const l0 = (r[1] || '').trim();
  const l1 = (r[2] || '').trim();
  const l2 = (r[3] || '').trim();
  if (!l0) { empty++; return; }
  if (l1 === 'Unclear Intent') { unclear++; return; }
  mapped++;
  l0s.add(l0);
  l1s.add(l1);
  l2s.add(l2);
});

console.log('Total rows:', data.length);
console.log('Mapped (L0+L1+L2, not Unclear):', mapped);
console.log('Unclear Intent:', unclear);
console.log('Empty:', empty);
console.log('\nUnique L0s (' + l0s.size + '):', [...l0s].sort().join(', '));
console.log('\nUnique L1s (' + l1s.size + '):');
[...l1s].sort().forEach(v => console.log('  ' + v));
console.log('\nSample L2s (first 20):');
[...l2s].sort().slice(0, 20).forEach(v => console.log('  ' + v));

// Also check IB columns coverage
let ibMapped = 0;
data.forEach(r => {
  if (r[4] || r[5] || r[6]) ibMapped++;
});
console.log('\nIB columns (your manual mapping) rows with data:', ibMapped);
