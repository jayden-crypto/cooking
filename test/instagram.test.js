import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseInstagramEmbed, parseInstagramUrl } from '../lib/instagram.js';

test('recognises the different Instagram link shapes', () => {
  assert.deepEqual(parseInstagramUrl('https://www.instagram.com/reel/AbC123xyz_-/?igsh=MWx0'), { kind: 'reel', code: 'AbC123xyz_-' });
  assert.deepEqual(parseInstagramUrl('https://instagram.com/p/AbC123xyz/'), { kind: 'p', code: 'AbC123xyz' });
  assert.deepEqual(parseInstagramUrl('https://www.instagram.com/reels/AbC123xyz/'), { kind: 'reel', code: 'AbC123xyz' });
  assert.deepEqual(parseInstagramUrl('https://www.instagram.com/some.chef/reel/AbC123xyz/'), { kind: 'reel', code: 'AbC123xyz' });
  assert.deepEqual(parseInstagramUrl('https://instagr.am/p/AbC123xyz'), { kind: 'p', code: 'AbC123xyz' });
  assert.deepEqual(parseInstagramUrl('https://www.instagram.com/share/reel/BAabcdef/'), { share: true });
  assert.deepEqual(parseInstagramUrl('https://www.instagram.com/some.chef/'), { profileOrOther: true });
  assert.equal(parseInstagramUrl('https://example.com/p/AbC123xyz'), null);
  assert.equal(parseInstagramUrl('not a url'), null);
});

function embedWithContextJson(media) {
  const contextJSON = JSON.stringify({ context: { type: media.__typename }, gql_data: { shortcode_media: media } });
  // Instagram double-encodes the JSON inside a script tag.
  return `<html><script>requireLazy(["x"],function(){s.handle({"contextJSON":${JSON.stringify(contextJSON)}})})</script></html>`;
}

test('reads the post from the embedded JSON', () => {
  const html = embedWithContextJson({
    __typename: 'GraphVideo',
    shortcode: 'AbC123xyz',
    is_video: true,
    display_url: 'https://scontent.cdninstagram.com/v/cover.jpg?oe=1',
    owner: { username: 'some.chef', profile_pic_url: 'https://scontent.cdninstagram.com/v/avatar.jpg' },
    edge_media_to_caption: { edges: [{ node: { text: 'Tomato soup\n\n2 tins tomatoes\n1 onion' } }] },
  });
  assert.deepEqual(parseInstagramEmbed(html, 'AbC123xyz'), {
    shortcode: 'AbC123xyz',
    username: 'some.chef',
    avatarUrl: 'https://scontent.cdninstagram.com/v/avatar.jpg',
    imageUrl: 'https://scontent.cdninstagram.com/v/cover.jpg?oe=1',
    caption: 'Tomato soup\n\n2 tins tomatoes\n1 onion',
    mediaType: 'video',
  });
});

test('falls back to the server-rendered embed markup', () => {
  const html = `
    <div class="EmbedSimple" data-media-type="GraphSidecar">
      <div class="Header"><div class="AvatarContainer"><a class="Avatar" href="#"><img src="https://cdn.example/avatar.jpg?a=1&amp;b=2" /></a></div>
      <a class="HeaderText"><span class="UsernameText">some.chef</span></a></div>
      <a class="EmbeddedMedia"><img class="EmbeddedMediaImage" alt="Instagram post shared by &#064;some.chef" src="https://cdn.example/photo.jpg?x=1&amp;y=2" /></a>
      <div class="Caption"><a class="CaptionUsername" href="#">some.chef</a><br /><br />Fish tacos &amp; slaw<br />300g white fish<br />8 tortillas<br /><br /><a href="/explore/tags/tacos/">#tacos</a><div class="CaptionComments">View all 12 comments</div></div>
    </div>`;
  const post = parseInstagramEmbed(html, 'XyZ987');
  assert.equal(post.username, 'some.chef');
  assert.equal(post.avatarUrl, 'https://cdn.example/avatar.jpg?a=1&b=2');
  assert.equal(post.imageUrl, 'https://cdn.example/photo.jpg?x=1&y=2');
  assert.equal(post.caption, 'Fish tacos & slaw\n300g white fish\n8 tortillas\n\n#tacos');
  assert.equal(post.mediaType, 'carousel');
});
