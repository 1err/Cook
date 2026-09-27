import React from 'react';
import {act,fireEvent,render,screen} from '@testing-library/react-native';
import {MenuImageNormalizer, type MenuImageNormalizerHandle} from './MenuImageNormalizer';
const mockPost=jest.fn();
jest.mock('react-native-webview',()=>{const React=require('react');const {View}=require('react-native');return{WebView:React.forwardRef((props:any,ref:any)=>{React.useImperativeHandle(ref,()=>({postMessage:mockPost}));return <View testID="normalizer" {...props}/>;})};});
beforeEach(()=>jest.clearAllMocks());
test('normalizes only matching local requests and blocks external navigation',async()=>{
  const ref=React.createRef<MenuImageNormalizerHandle>();await render(<MenuImageNormalizer ref={ref}/>);
  const webview=screen.getByTestId('normalizer', { includeHiddenElements: true });
  expect(webview.props.onShouldStartLoadWithRequest({url:'https://outside.test'})).toBe(false);
  expect(webview.props.source.html).toContain("connect-src 'none'");
  let completed=false;const pending=ref.current!.normalize('data:image/jpeg;base64,/9j/',new AbortController().signal).then(value=>{completed=true;return value;});
  expect(mockPost).not.toHaveBeenCalled();await fireEvent(webview,'loadEnd');
  const request=JSON.parse(mockPost.mock.calls[0][0]);
  await fireEvent(webview,'message',{nativeEvent:{data:JSON.stringify({id:'wrong',dataUrl:'data:image/png;base64,iVBORw0KGgo='})}});
  expect(completed).toBe(false);
  await fireEvent(webview,'message',{nativeEvent:{data:JSON.stringify({id:request.id,dataUrl:'data:image/png;base64,iVBORw0KGgo='})}});
  await expect(pending).resolves.toBe('data:image/png;base64,iVBORw0KGgo=');
});
test('aborts a queued conversion and rejects work when its account session unmounts',async()=>{
  const ref=React.createRef<MenuImageNormalizerHandle>();const view=await render(<MenuImageNormalizer ref={ref}/>);
  const controller=new AbortController();const pending=ref.current!.normalize('data:image/jpeg;base64,/9j/',controller.signal).catch(error=>error.message);
  await act(async()=>controller.abort());await expect(pending).resolves.toMatch(/cancelled/);
  const second=ref.current!.normalize('data:image/jpeg;base64,/9j/',new AbortController().signal).catch(error=>error.message);
  await view.unmount();await expect(second).resolves.toMatch(/unavailable/);
});
