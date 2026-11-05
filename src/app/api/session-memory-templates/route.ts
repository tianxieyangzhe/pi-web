/** Retired endpoint: never reads historical application memory. */
export function GET() { return Response.json({error:{code:'NOT_FOUND',message:'接口不存在',recoverable:false}},{status:404,headers:{'cache-control':'no-store'}}); }
export const POST = GET;
export const PATCH = GET;
export const PUT = GET;
export const DELETE = GET;
