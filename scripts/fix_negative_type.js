// One-time fix: change Type column from "Negative" to "Service" for negative_v1 rows
const fs = require('fs')
const files = [
  '/Users/ishaanbhatnagar/Desktop/BLU-Automation/automation/test-output/blu_test_cases_v7.csv',
  '/Users/ishaanbhatnagar/Desktop/BLU-Automation/automation/test-output/blu_negative_test_cases.csv',
]
files.forEach(f => {
  const before = fs.readFileSync(f, 'utf8')
  // Replace ,"No","Negative","Negative","manual","negative_v1"
  //      with ,"No","Service","Negative","manual","negative_v1"
  const after = before.split(',"No","Negative","Negative","manual","negative_v1"')
                      .join(',"No","Service","Negative","manual","negative_v1"')
  if (before !== after) {
    fs.writeFileSync(f, after, 'utf8')
    const count = (before.match(/,"No","Negative","Negative","manual","negative_v1"/g)||[]).length
    console.log(`✅ Fixed ${count} rows in ${f.split('/').pop()}`)
  } else {
    console.log(`⚠ No changes in ${f.split('/').pop()} — pattern not found`)
  }
})
