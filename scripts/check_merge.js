const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const jsonDir = 'JSON(s)/May 07 - Latest Content';
const jsonQuestions = new Set();
fs.readdirSync(jsonDir).filter(f => f.endsWith('.json')).forEach(f => {
  JSON.parse(fs.readFileSync(path.join(jsonDir, f), 'utf-8'))
    .forEach(e => { if (e.question) jsonQuestions.add(e.question.trim().toLowerCase()); });
});
console.log('JSON unique questions:', jsonQuestions.size);

const loanWb = XLSX.readFile('data/Loan Knowledge Repository version-1.1.xlsx');
const loanData = XLSX.utils.sheet_to_json(loanWb.Sheets[loanWb.SheetNames[0]], { header: 1 }).slice(1);
const loanNew = loanData.filter(r => r[3] && !jsonQuestions.has(String(r[3]).trim().toLowerCase()));
console.log('Loan repo total:', loanData.length);
console.log('Loan repo NEW (not in JSONs):', loanNew.length);

const insWb = XLSX.readFile('data/Insurance Knowledge Repository version 1.1 1.xlsx');
const insData = XLSX.utils.sheet_to_json(insWb.Sheets[insWb.SheetNames[0]], { header: 1 }).slice(1);
const insNew = insData.filter(r => r[3] && !jsonQuestions.has(String(r[3]).trim().toLowerCase()));
console.log('Insurance repo total:', insData.length);
console.log('Insurance repo NEW (not in JSONs):', insNew.length);
console.log('Total new entries to merge:', loanNew.length + insNew.length);
