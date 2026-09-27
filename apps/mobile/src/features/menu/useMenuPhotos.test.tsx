import { act, renderHook, waitFor } from '@testing-library/react-native';
import { menuPhotoResponseDataUrl, publicMenuPhotoUrl, useMenuPhotos } from './useMenuPhotos';
const mockImage = jest.fn(); const mockApi = { menus: { recipeImage: mockImage } };
jest.mock('../../lib/api', () => ({ useApiClient: () => mockApi }));
const png = new Uint8Array([137,80,78,71,13,10,26,10]);
const response = (bytes: Uint8Array, type: string, size = bytes.length) => ({ok:true,url:'',headers:{get:(key:string)=>key==='content-type'?type:String(size)},arrayBuffer:jest.fn(async()=>bytes.buffer)}) as unknown as Response;
const item = {recipeId:'one',sectionId:'main',name:'Soup',description:'',imageUrl:'https://photos.example.com/soup.jpg'};
beforeEach(()=>jest.clearAllMocks());
test('accepts bounded PNG and JPEG bytes and rejects mismatched or oversized bodies', async()=>{
  await expect(menuPhotoResponseDataUrl(response(png,'image/png'))).resolves.toBe('data:image/png;base64,iVBORw0KGgo=');
  await expect(menuPhotoResponseDataUrl(response(new Uint8Array([255,216,255,224]),'image/jpeg'))).resolves.toMatch(/^data:image\/jpeg;base64,/);
  await expect(menuPhotoResponseDataUrl(response(png,'image/jpeg'))).rejects.toThrow();
  const huge=response(png,'image/png',20_000_000);
  await expect(menuPhotoResponseDataUrl(huge)).rejects.toThrow();expect(huge.arrayBuffer).not.toHaveBeenCalled();
});
test('external fallback excludes credentials, local network addresses and non-HTTPS URLs',()=>{
  expect(publicMenuPhotoUrl(item.imageUrl!)).toBe(true);
  for(const url of ['http://photos.example.com/a','https://user:secret@photos.example.com/a','https://127.0.0.1/a','https://192.168.1.1/a','https://host.local/a','https://[::1]/a','file:///tmp/a'])expect(publicMenuPhotoUrl(url)).toBe(false);
});
test('loads an owned JPEG, normalizes to PNG, and reuses bytes across text-only edits',async()=>{
  mockImage.mockResolvedValue(response(new Uint8Array([255,216,255,224]),'image/jpeg'));
  const normalize=jest.fn(async(_dataUrl: string, _signal: AbortSignal)=> 'data:image/png;base64,iVBORw0KGgo=');
  const {result,rerender}=await renderHook<ReturnType<typeof useMenuPhotos>, {items: typeof item[]}>(({items})=>useMenuPhotos(items,normalize),{initialProps:{items:[item]}});
  await waitFor(()=>expect(result.current.itemImages.one).toBe('data:image/png;base64,iVBORw0KGgo='));
  expect(normalize.mock.calls[0][0]).toMatch(/^data:image\/jpeg;base64,/);
  await rerender({items:[{...item,name:'My soup'}]});
  expect(mockImage).toHaveBeenCalledTimes(1);
  expect(result.current.loading).toBe(false);
});
test('selection change aborts pending image bytes and ignores the late result',async()=>{
  let resolve!:(response:Response)=>void;
  mockImage.mockReturnValue(new Promise(done=>{resolve=done;}));
  const normalize=jest.fn(async(_dataUrl: string, _signal: AbortSignal)=> 'data:image/png;base64,iVBORw0KGgo=');
  const {result,rerender}=await renderHook<ReturnType<typeof useMenuPhotos>, {items: typeof item[]}>(({items})=>useMenuPhotos(items,normalize),{initialProps:{items:[item]}});
  await waitFor(()=>expect(mockImage).toHaveBeenCalledTimes(1));
  const signal=mockImage.mock.calls[0][1].signal;
  await rerender({items:[]});
  await act(async()=>resolve(response(png,'image/png')));
  expect(signal.aborted).toBe(true);
  expect(result.current.itemImages).toEqual({});
  expect(result.current.loading).toBe(false);
});
