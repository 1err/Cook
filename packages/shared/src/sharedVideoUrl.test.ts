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
