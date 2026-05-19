const XLSX = require('xlsx');
const wb = XLSX.readFile(process.env.HOME + '/Desktop/dlp_temp/Chat_dump_L0_L1_L2_Mapped_V13.xlsx');
console.log('All sheets:', wb.SheetNames);
wb.SheetNames.forEach(s => {
  const ws = wb.Sheets[s];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
  console.log('\nSheet:', s, '| Rows:', data.length);
  console.log('Headers:', JSON.stringify(data[0]));
  console.log('Row 1:', JSON.stringify(data[1]).slice(0, 300));
  console.log('Row 2:', JSON.stringify(data[2]).slice(0, 300));
});
