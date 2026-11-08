'use strict';

function pdfFixture(...lines) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${lines.length} /Kids [${lines.map((_,i)=>4+i*2+' 0 R').join(' ')}] >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  for(const [index,line] of lines.entries()){
    const contents = `BT /F1 16 Tf 48 700 Td (${line.replace(/[()\\]/g,'\\$&')}) Tj ET\n`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5+index*2} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(contents)} >>\nstream\n${contents}endstream`);
  }
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  for(const [index,object] of objects.entries()){
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index+1} 0 obj\n${object}\nendobj\n`;
  }
  const start = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  for(const offset of offsets)pdf += String(offset).padStart(10,'0')+' 00000 n \n';
  return Buffer.from(pdf+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`);
}

module.exports={pdfFixture};
