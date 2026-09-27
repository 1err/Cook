'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FULL_MENU_RECIPE_LIMIT, resolveMenuArtwork, type GenerateFullMenuPayload, type MenuCreationAccess, type RecipeImageAccess } from '@cooking/api-client';
import { createUuid } from '@cooking/shared';
import { useAuth } from '../../lib/auth';
import { webApiClient } from '../../lib/api';
import { artworkResponseDataUrl } from './menuAssets';

type MenuInput = Omit<GenerateFullMenuPayload, 'request_id' | 'mode'>;
type GeneratedMenu = { dataUrl:string; title:string; requestId:string };
const rejectionKeys: Record<string, string> = {
 recipe_not_found:'menu.simple.selectionChanged', recipe_changed:'menu.simple.selectionChanged', menu_daily_limit:'menu.creation.limitReached', daily_limit:'menu.simple.imageLimit', global_limit:'menu.simple.unavailable',
 rate_limited:'imageGeneration.rateLimited', membership_required:'menu.simple.membershipRequired', disabled:'menu.simple.unavailable', unavailable:'menu.simple.unavailable',
};
export function useGeneratedMenu() {
 const { user } = useAuth(); const account = user?.id;
 const identity = useRef(account); identity.current = account;
 const epoch = useRef(0); const operation = useRef<AbortController | null>(null);
 const request = useRef<GenerateFullMenuPayload | null>(null);
 const requestReset = useRef<string | null>(null);
 const accessOperation = useRef<AbortController | null>(null);
 const accessEpoch = useRef(0); const exhaustedUntil = useRef<string | null>(null);
 const [access, setAccess] = useState<MenuCreationAccess | null>(null);
 const [artworkAccess, setArtworkAccess] = useState<RecipeImageAccess | null>(null);
 const [checkingAccess, setCheckingAccess] = useState(true);
 const [accessError, setAccessError] = useState<string | null>(null);
 const [busy, setBusy] = useState(false); const [checkingResult, setCheckingResult] = useState(false);
 const [result, setResult] = useState<GeneratedMenu | null>(null);
 const [errorKey, setErrorKey] = useState<string | null>(null); const [recoverable, setRecoverable] = useState(false);
 const accessRef = useRef(access); accessRef.current = access;
 const artworkAccessRef = useRef(artworkAccess); artworkAccessRef.current = artworkAccess;

 const refresh = useCallback(async () => {
  const owner = account; const version = ++accessEpoch.current;
  accessOperation.current?.abort(); const controller = new AbortController(); accessOperation.current = controller;
  const current = () => identity.current === owner && version === accessEpoch.current && !controller.signal.aborted;
  setCheckingAccess(true); setAccessError(null);
  let timer:ReturnType<typeof setTimeout> | undefined; let abort:() => void = () => {};
  const cancelled = new Promise<never>((_,reject) => { abort=() => reject(new Error('Access check cancelled')); controller.signal.addEventListener('abort',abort,{ once:true }); timer=setTimeout(() => controller.abort(),30_000); });
  try {
   const [next, artwork] = await Promise.race([Promise.all([webApiClient.menus.access({ signal:controller.signal }),webApiClient.menus.artworkAccess({ signal:controller.signal })]),cancelled]);
   if (!current()) return;
   if (exhaustedUntil.current && exhaustedUntil.current !== next.resets_at) exhaustedUntil.current=null;
   setAccess(exhaustedUntil.current && !next.is_admin ? { ...next, allowed:false, remaining:0 } : next);
   setArtworkAccess(artwork);
   setErrorKey(current => current === 'menu.creation.limitReached' && next.allowed && !exhaustedUntil.current || current === 'menu.simple.imageLimit' && artwork.allowed ? null : current);
  } catch { if (identity.current === owner && version === accessEpoch.current) setAccessError('menu.creation.unavailable'); }
  finally {
   clearTimeout(timer); controller.signal.removeEventListener('abort',abort);
   if (accessOperation.current === controller) accessOperation.current=null;
   if (identity.current === owner && version === accessEpoch.current) setCheckingAccess(false);
  }
 },[account]);
 useEffect(() => {
  epoch.current++; operation.current?.abort(); operation.current=null; request.current=null; requestReset.current=null; exhaustedUntil.current=null;
  setAccess(null); setArtworkAccess(null); setResult(null); setBusy(false); setRecoverable(false); setErrorKey(null);
  if (account) void refresh(); else { setCheckingAccess(false); setAccessError('menu.creation.unavailable'); }
  return () => { epoch.current++; accessEpoch.current++; operation.current?.abort(); accessOperation.current?.abort(); };
 },[account,refresh]);

 useEffect(() => {
  const update=() => { if (account && !operation.current && !accessOperation.current) void refresh(); };
  const visible=() => { if (document.visibilityState === 'visible') update(); };
  window.addEventListener('focus',update); document.addEventListener('visibilitychange',visible);
  const resetsAt=access?.resets_at ? Date.parse(access.resets_at) : NaN;
  const timer=Number.isFinite(resetsAt) && resetsAt > Date.now() ? setTimeout(update,Math.min(2_147_483_647,resetsAt-Date.now()+250)) : undefined;
  return () => { window.removeEventListener('focus',update); document.removeEventListener('visibilitychange',visible); clearTimeout(timer); };
 },[account,access?.resets_at,refresh]);

 const run = useCallback(async (payload:GenerateFullMenuPayload, mode:'generate' | 'check') => {
  if (operation.current) return;
  const controller = new AbortController(); operation.current=controller;
  const version=++epoch.current; const owner=account; const admittedReset=requestReset.current;
  const belongs = () => identity.current === owner && epoch.current === version;
  const current = () => belongs() && !controller.signal.aborted;
  let timedOut=false; let rejectAbort:() => void = () => {};
  const cancelled = new Promise<never>((_,reject) => { rejectAbort=() => reject(new Error('Menu operation ended')); controller.signal.addEventListener('abort',rejectAbort,{ once:true }); });
  const deadline=setTimeout(() => { timedOut=true; controller.abort(); },270_000);
  setBusy(true); setCheckingResult(mode === 'check'); setErrorKey(null); setRecoverable(false);
  try {
   const retrieve = async () => {
    const generated = await resolveMenuArtwork(webApiClient.menus,payload,{ mode,signal:controller.signal });
    if (!current()) throw new Error('Menu operation ended');
    if (accessRef.current && !accessRef.current.is_admin && admittedReset === accessRef.current.resets_at) {
     exhaustedUntil.current=accessRef.current.resets_at; setAccess({ ...accessRef.current,allowed:false,remaining:0 });
    }
    if (generated.status !== 'completed') throw Object.assign(new Error('Menu generation failed'),{ terminal:true });
    const response = await webApiClient.menus.artworkFile(payload.request_id,{ signal:controller.signal });
    if (!current()) throw new Error('Menu operation ended');
    return artworkResponseDataUrl(response);
   };
   const dataUrl=await Promise.race([retrieve(),cancelled]);
   if (!current()) return;
   setResult({ dataUrl,title:payload.title ?? '',requestId:payload.request_id }); request.current=null;
   if (accessRef.current && !accessRef.current.is_admin && admittedReset === accessRef.current.resets_at) {
    exhaustedUntil.current=accessRef.current.resets_at; setAccess({ ...accessRef.current,allowed:false,remaining:0 });
   }
  } catch (error) {
   if (!belongs() || controller.signal.aborted && !timedOut) return;
   const failure=error as { code?:string; status?:number; terminal?:boolean };
   const definitive=failure.terminal || !!failure.code && !!rejectionKeys[failure.code] || [400,401,403,409,422].includes(failure.status ?? 0);
   if (failure.code === 'menu_daily_limit' && accessRef.current) {
    exhaustedUntil.current=accessRef.current.resets_at; setAccess({ ...accessRef.current,allowed:false,remaining:0 });
   }
   setErrorKey(failure.code && rejectionKeys[failure.code] || (failure.terminal ? 'menu.simple.terminalFailed' : 'menu.simple.failed'));
   setRecoverable(!definitive); if (definitive) request.current=null;
  } finally {
   clearTimeout(deadline); controller.signal.removeEventListener('abort',rejectAbort);
   if (operation.current === controller) operation.current=null;
   if (belongs()) { setBusy(false); void refresh(); }
  }
 },[account,refresh]);
 const canGenerate=!!account && !busy && !recoverable && !checkingAccess && !accessError && !!access?.allowed && !!artworkAccess?.allowed && !exhaustedUntil.current;
 return {
  access,artworkAccess,busy,checkingResult,checkingAccess,accessError,result,errorKey,recoverable,canGenerate,refresh,
  generate(input:MenuInput) {
   if (operation.current || request.current || !account || !accessRef.current?.allowed || !artworkAccessRef.current?.allowed || exhaustedUntil.current || input.recipes.length < 1 || input.recipes.length > FULL_MENU_RECIPE_LIMIT || (input.title?.length ?? 0) > 120 || (input.brief?.length ?? 0) > 1200) return;
   const payload:GenerateFullMenuPayload={ request_id:createUuid(),mode:'full-menu-v1',title:input.title ?? '',brief:input.brief ?? '',recipes:input.recipes.map(recipe => ({ ...recipe })) };
   request.current=payload; requestReset.current=accessRef.current.resets_at; setResult(null); void run(payload,'generate');
  },
  selectionRefreshed() { setErrorKey(current => current === 'menu.simple.selectionChanged' ? null : current); },
  check() { if (request.current) void run(request.current,'check'); },
  cancel() { if (!operation.current) return; epoch.current++; operation.current.abort(); operation.current=null; setBusy(false); setRecoverable(!!request.current); setErrorKey(null); },
 };
}
