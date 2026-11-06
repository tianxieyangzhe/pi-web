import path from 'node:path';
import { unzipSync } from 'fflate';
import { DOMParser } from 'linkedom';

const MAX_EXPANDED = 50_000_000;
type XmlContainer = { getElementsByTagName(tag:string): ArrayLike<XmlElement> };
type XmlElement = XmlContainer & { textContent:string|null; getAttribute(name:string):string|null };
// Restrict linkedom's XML DOM to the small read-only interface used here.
const xml = (bytes: Uint8Array) => new DOMParser().parseFromString(new TextDecoder('utf-8',{fatal:true}).decode(bytes), 'text/xml') as unknown as XmlContainer;
const elements = (node: XmlContainer, tag: string) => Array.from(node.getElementsByTagName(tag));
const paragraphs = (document: XmlContainer, tag: string) => elements(document,tag).map(node=>node.textContent??'').join('\n');
export function documentText(name: string, bytes: Buffer): { text?: string; note: string } {
  const ext=path.extname(name).toLowerCase();
  if (!['.docx','.xlsx','.pptx','.odt','.ods','.odp'].includes(ext)) {
    if (['.doc','.xls','.ppt','.pdf'].includes(ext)) return {note:'原件为二进制文档；需要通过 bash 和可用的文档解析器读取。未生成正文，请勿声称已经读到内容。'};
    return {note:'UTF-8文件，可直接通过读取工具按行读取原件。'};
  }
  try {
    let count=0,total=0;
    const files=unzipSync(bytes,{filter(file){
      if(++count>10000)throw Error('ZIP条目超过10000');
      total+=file.originalSize;if(!Number.isSafeInteger(total)||total>MAX_EXPANDED)throw Error('ZIP展开内容超过50MB');
      return file.name==='word/document.xml'||file.name==='xl/sharedStrings.xml'||/^xl\/worksheets\/sheet\d+\.xml$/.test(file.name)||/^ppt\/slides\/slide\d+\.xml$/.test(file.name)||file.name==='content.xml';
    }});
    let text='';
    if(ext==='.docx'&&files['word/document.xml'])text=paragraphs(xml(files['word/document.xml']),'w:p');
    else if(ext==='.pptx')text=Object.keys(files).filter(key=>key.startsWith('ppt/slides/')).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})).map(key=>`[${key}]\n${paragraphs(xml(files[key]),'a:p')}`).join('\n\n');
    else if(ext==='.xlsx'){
      const strings=files['xl/sharedStrings.xml']?elements(xml(files['xl/sharedStrings.xml']),'si').map(node=>node.textContent??''):[];
      text=Object.keys(files).filter(key=>key.startsWith('xl/worksheets/')).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})).map(key=>`[${key}]\n`+elements(xml(files[key]),'row').map(row=>elements(row,'c').map(cell=>{
        const value=elements(cell,'v')[0]?.textContent??'';
        return `${cell.getAttribute('r')??''}=${cell.getAttribute('t')==='s'?strings[Number(value)]??'':cell.getAttribute('t')==='inlineStr'?elements(cell,'is')[0]?.textContent??'':value}`;
      }).join('\t')).join('\n')).join('\n\n');
    }else if(files['content.xml'])text=paragraphs(xml(files['content.xml']),'text:p');
    if(!text.trim())throw Error('没有可提取的正文（可能为加密、损坏或仅图片文档）');
    if(Buffer.byteLength(text)>MAX_EXPANDED)throw Error('提取文本超过50MB');
    return {text,note:'已提供提取的UTF-8文本副本；正文、表格值及页/工作表来源可通过读取工具查看，图表、格式及公式重算结果不在文本提取保证内。'};
  }catch(error){return {note:`正文提取失败：${error instanceof Error?error.message:'无法解析'}。保留原件，需要额外解析器；请勿把文件名或二进制内容当作已读正文。`};}
}
