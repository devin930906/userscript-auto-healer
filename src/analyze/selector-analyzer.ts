/** TASK-003 / REQ-011: conservative, read-only selector evidence from Acorn AST. */
import { parse } from 'acorn';

const METHODS = new Set([
  'querySelector','querySelectorAll','getElementById',
  'getElementsByClassName','getElementsByName','getElementsByTagName'
]);
export type SelectorKind = 'literal' | 'needs-runtime-confirmation';
export interface SelectorSite {
  readonly line:number;
  readonly column:number;
  readonly offset:number;
  readonly owner:string;
  readonly scope:string;
  readonly method:string;
  readonly selector:string|null;
  readonly kind:SelectorKind;
  readonly fallbackGroup:number|null;
}
export interface SelectorAnalysis {
  readonly status:'OK'|'PARSE_ERROR'|'SOURCE_TOO_LARGE';
  readonly sites:SelectorSite[];
}
type AstNode = {
  type:string;start?:number;end?:number;
  loc?:{start:{line:number;column:number}};
  [key:string]:unknown;
};
function nodeOf(value:unknown):AstNode|null {
  return value && typeof value==='object' && typeof (value as AstNode).type==='string'
    ? value as AstNode : null;
}
function argumentData(value:unknown):{kind:SelectorKind;selector:string|null} {
  const n=nodeOf(value);
  if(n?.type==='Literal' && typeof n.value==='string')return {kind:'literal',selector:n.value};
  if(n?.type==='TemplateLiteral' && Array.isArray(n.expressions) &&
      n.expressions.length===0 && Array.isArray(n.quasis)){
    const selector=n.quasis.map(item=>{
      const element=nodeOf(item);
      const value=element?.value;
      if(!value || typeof value!=='object' || !('cooked' in value))return '';
      return String((value as {cooked:unknown}).cooked ?? '');
    }).join('');
    return {kind:'literal',selector};
  }
  return {kind:'needs-runtime-confirmation',selector:null};
}
function memberName(n:AstNode):string|null {
  const member=nodeOf(n.property);
  if(n.computed===true)
    return member?.type==='Literal' && typeof member.value==='string'?member.value:null;
  return member?.type==='Identifier' && typeof member.name==='string'?member.name:null;
}
/** Never evaluate the source or claim a successful DOM/business action. */
export function analyzeSelectors(source:string):SelectorAnalysis {
  if(typeof source!=='string' || Buffer.byteLength(source,'utf-8')>8*1024*1024)
    return {status:'SOURCE_TOO_LARGE',sites:[]};
  let ast:AstNode;
  try{
    ast=parse(source,{ecmaVersion:'latest',sourceType:'script',locations:true}) as unknown as AstNode;
  }catch{
    return {status:'PARSE_ERROR',sites:[]};
  }
  const sites:SelectorSite[]=[];
  function walk(node:AstNode,owners:string[],fallback:number|null,functionLabel?:string):void {
    let scope=owners;
    if(node.type==='FunctionDeclaration'||node.type==='FunctionExpression'||
        node.type==='ArrowFunctionExpression'){
      const n=nodeOf(node.id)?.name;
      const inferred=typeof n==='string'?n:
        node.type==='ArrowFunctionExpression'?'<arrow>':'<anonymous>';
      scope=[...owners,functionLabel??inferred];
    }
    if(node.type==='VariableDeclarator'){
      const child=nodeOf(node.init);
      const name=nodeOf(node.id)?.name;
      if(child && (child.type==='ArrowFunctionExpression'||child.type==='FunctionExpression') &&
          typeof name==='string'){
        walk(child,owners,fallback,name);
        return;
      }
    }
    let group=fallback;
    if(node.type==='LogicalExpression' && (node.operator==='||'||node.operator==='??'))
      group=fallback ?? (node.start ?? 0);
    if(node.type==='CallExpression'){
      const callee=nodeOf(node.callee);
      if(callee?.type==='MemberExpression'){
        const name=memberName(callee);
        const recognized=name!==null && METHODS.has(name);
        if(recognized || (callee.computed===true && name===null)){
          const args=Array.isArray(node.arguments)?node.arguments:[];
          const detail=recognized?argumentData(args[0]):
            {kind:'needs-runtime-confirmation' as const,selector:null};
          sites.push({
            line:node.loc?.start.line??0,
            column:(node.loc?.start.column??0)+1,
            offset:node.start??0,
            owner:scope.at(-1)??'<top-level>',
            scope:scope.join('/')||'<top-level>',
            method:recognized?name!:'<dynamic-member>',
            selector:detail.selector,kind:detail.kind,fallbackGroup:group
          });
        }
      }
    }
    for(const [key,value] of Object.entries(node)){
      if(['loc','start','end','raw'].includes(key))continue;
      if(Array.isArray(value)){
        for(const item of value){const child=nodeOf(item);if(child)walk(child,scope,group);}
      }else{
        const child=nodeOf(value);if(child)walk(child,scope,group);
      }
    }
  }
  walk(ast,[],null);
  sites.sort((a,b)=>a.offset-b.offset);
  return {status:'OK',sites};
}
