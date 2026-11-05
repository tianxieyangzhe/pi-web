const ignored=new Set(['.git','.data','.next','.turbo','coverage','dist','build','node_modules']);
const sensitive=[/^\.env(?!\.(?:example|sample)$)(?:\.|$)/i,/^\.(?:ssh|aws|codex)$/i,/^\.(?:npmrc|pypirc|netrc|git-credentials)$/i,/^credentials?(?:\.|$)/i,/^auth\.json$/i,/^id_(?:rsa|dsa|ecdsa|ed25519)/i,/\.(?:pem|key)$/i];
export const isProjectPathForbidden=(value:string)=>value.split(/[\\/]/).some(part=>ignored.has(part)||sensitive.some(pattern=>pattern.test(part)));
