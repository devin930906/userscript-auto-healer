/** TASK-007 / TEST-017/026: value-free GitHub Actions page diagnostics.
 * A Tampermonkey vendor URL can contain a nested installation URL and bearer
 * key inside its fragment (#url=http://.../install.user.js?key=...).
 * Sanitizing only top-level query parameters still exposes that secret.
 *
 * Never return an input URL, hostname, port, query, fragment, arbitrary path,
 * or other attacker-controlled string. These labels are diagnostics only;
 * they do NOT authenticate a manager, browser, script, or test result.
 */
'use strict';

function classifyTampermonkeyPageUrl(input){
  if(typeof input!=='string')return 'OTHER_PAGE';
  let url;
  try{url=new URL(input);}catch{return 'OTHER_PAGE';}
  if(url.protocol==='about:'&&url.pathname==='blank')
    return 'BLANK_PAGE';
  if(url.protocol==='chrome-extension:'){
    if(url.pathname==='/ask.html')return 'MANAGER_CONFIRMATION';
    if(url.pathname==='/options.html')return 'MANAGER_OPTIONS';
    return 'OTHER_EXTENSION_PAGE';
  }
  if(url.protocol==='http:'&&url.hostname==='127.0.0.1')
    return 'DISPOSABLE_LOCAL_PAGE';
  if(url.protocol==='https:'&&url.hostname==='www.tampermonkey.net')
    return 'VENDOR_INSTALL_FLOW';
  return 'OTHER_PAGE';
}

module.exports={classifyTampermonkeyPageUrl};
