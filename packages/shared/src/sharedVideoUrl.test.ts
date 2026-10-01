import { expect, test } from 'vitest';
import { extractSharedVideoUrl } from './sharedVideoUrl';

test('copied Chinese share text keeps the public RedNote URL and upgrades HTTP', () => {
  expect(extractSharedVideoUrl(null, '排骨教程 http://xhslink.com/o/QFcd665bHC，复制后打开小红书！'))
    .toBe('https://xhslink.com/o/QFcd665bHC');
});

test.each(['https://vm.tiktok.com/Example/', 'https://www.tiktok.com/@chef/video/12345',
  'https://v.douyin.com/yEtHaXkpL6g/', 'https://www.douyin.com/video/7690375454679248314'])
  ('unsupported sources cannot become a shared recipe link: %s', source => {
    expect(extractSharedVideoUrl(source, `看看这个 ${source}`)).toBeNull();
  });

test('unsupported share content does not hide a supported YouTube link', () => {
  expect(extractSharedVideoUrl('https://v.douyin.com/yEtHaXkpL6g/', 'Recipe https://youtu.be/GSz4Na7hO5Y'))
    .toBe('https://youtu.be/GSz4Na7hO5Y');
});

test.each([
  ['https://xhslink.cn/o/9wzZ6DxJYSS', 'https://xhslink.cn/o/9wzZ6DxJYSS'],
  ['http://xhslink.cn/o/9wzZ6DxJYSS', 'https://xhslink.cn/o/9wzZ6DxJYSS'],
  ['https://www.xhslink.cn/o/9wzZ6DxJYSS', 'https://www.xhslink.cn/o/9wzZ6DxJYSS'],
  ['https://xhslink.cn/o/9wzZ6DxJYSS?xsec_token=fixture%3D', 'https://xhslink.cn/o/9wzZ6DxJYSS?xsec_token=fixture%3D'],
  ['零失败的懒人教程｜苹果牛肋条 🥣材料： 肥瘦三七开带... https://xhslink.cn/o/9wzZ6DxJYSS Copy and open rednote to view the note', 'https://xhslink.cn/o/9wzZ6DxJYSS'],
  ['看看这个 http://xhslink.cn/o/9wzZ6DxJYSS，复制后打开小红书！', 'https://xhslink.cn/o/9wzZ6DxJYSS'],
])('accepts RedNote cn links from URL or copied share text: %s', (input, expected) => {
  expect(extractSharedVideoUrl(input, null)).toBe(expected);
  expect(extractSharedVideoUrl(null, input)).toBe(expected);
});

test.each([
  'https://xhslink.cn.evil.test/o/9wzZ6DxJYSS',
  'https://evil.xhslink.cn/o/9wzZ6DxJYSS',
  'https://user@xhslink.cn/o/9wzZ6DxJYSS',
  'https://user:secret@xhslink.cn/o/9wzZ6DxJYSS',
  'https://xhslink.cn:444/o/9wzZ6DxJYSS',
  'https://xhslink.cn/o/9wzZ6DxJYSS/extra',
  'https://xhslink.cn/',
])('rejects unsafe or malformed RedNote cn URLs: %s', input => {
  expect(extractSharedVideoUrl(input, null)).toBeNull();
});
