const XLSX = require('xlsx');
const dir = process.env.HOME + '/Desktop/dlp_temp';
const wb = XLSX.readFile(dir + '/SR Dump (Sample).xlsx');
console.log('Sheets:', wb.SheetNames);
wb.SheetNames.forEach(s => {
  const ws = wb.Sheets[s];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
  console.log('\nSheet:', s, '| Rows:', data.length);
  console.log('Headers:', JSON.stringify(data[0]).slice(0, 300));
  console.log('Row 1:', JSON.stringify(data[1]).slice(0, 300));
  console.log('Row 2:', JSON.stringify(data[2]).slice(0, 300));
});
