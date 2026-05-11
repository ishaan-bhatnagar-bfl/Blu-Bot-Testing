const XLSX = require('xlsx');
const dir = process.env.HOME + '/Desktop/dlp_temp';
const wb = XLSX.readFile(dir + '/SR Dump (Sample).xlsx');

console.log('=== Test File ===');
const tf = XLSX.utils.sheet_to_json(wb.Sheets['Test File']);
const types = new Set(), subtypes = new Set(), products = new Set();
let hasReason = 0;
tf.forEach(r => {
  if (r.TYPE__C && r.TYPE__C !== 'null') types.add(r.TYPE__C);
  if (r.SUB_TYPE__C && r.SUB_TYPE__C !== 'null') subtypes.add(r.SUB_TYPE__C);
  if (r.PRODUCT_TYPE__C && r.PRODUCT_TYPE__C !== 'null') products.add(r.PRODUCT_TYPE__C);
  if (r.INTERNAL_CASE_REASON__C && r.INTERNAL_CASE_REASON__C !== 'null') hasReason++;
});
console.log('TYPE__C (L1) values:', [...types].sort().join(', '));
console.log('SUB_TYPE__C (L2) values:', [...subtypes].sort().join('\n  '));
console.log('PRODUCT_TYPE__C values:', [...products].sort().join(', '));
console.log('Rows with INTERNAL_CASE_REASON__C:', hasReason);

console.log('\n=== Edited Sheet ===');
const ed = XLSX.utils.sheet_to_json(wb.Sheets['Edited']);
const types2 = new Set(), subtypes2 = new Set();
let hasQuery = 0, hasDisp = 0;
ed.forEach(r => {
  if (r.TYPE__C && r.TYPE__C !== 'null') types2.add(r.TYPE__C);
  if (r.SUB_TYPE__C && r.SUB_TYPE__C !== 'null') subtypes2.add(r.SUB_TYPE__C);
  if (r.CUSTOMER_QUERY__C && r.CUSTOMER_QUERY__C !== 'null') hasQuery++;
  if (r.DISPOSITION && r.DISPOSITION !== 'null') hasDisp++;
});
console.log('TYPE__C (L1) values:', [...types2].sort().join(', '));
console.log('SUB_TYPE__C (L2) values:', [...subtypes2].sort().join('\n  '));
console.log('Rows with CUSTOMER_QUERY__C:', hasQuery);
console.log('Rows with DISPOSITION:', hasDisp);
