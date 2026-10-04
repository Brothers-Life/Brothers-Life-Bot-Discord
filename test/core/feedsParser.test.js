import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeEntities, parseFeed } from '../../src/core/feedParser.js';
import { youtubeChannelId, youtubeVideos } from '../../src/core/streamProviders.js';

// Shape of https://www.youtube.com/feeds/videos.xml?channel_id=… (checked on a real channel, October 2026)
export const YOUTUBE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
 <link rel="self" href="http://www.youtube.com/feeds/videos.xml?channel_id=UC_x5XG1OV2P6uZZ5FSM9Ttw"/>
 <id>yt:channel:_x5XG1OV2P6uZZ5FSM9Ttw</id>
 <yt:channelId>_x5XG1OV2P6uZZ5FSM9Ttw</yt:channelId>
 <title>Brothers Life</title>
 <link rel="alternate" href="https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw"/>
 <author><name>Brothers Life</name><uri>https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw</uri></author>
 <published>2007-08-23T00:34:43+00:00</published>
 <entry>
  <id>yt:video:8Xv5BLnXzgI</id>
  <yt:videoId>8Xv5BLnXzgI</yt:videoId>
  <yt:channelId>UC_x5XG1OV2P6uZZ5FSM9Ttw</yt:channelId>
  <title>Course-poursuite &amp; arrestation</title>
  <link rel="alternate" href="https://www.youtube.com/shorts/8Xv5BLnXzgI"/>
  <author><name>Brothers Life</name><uri>https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw</uri></author>
  <published>2026-10-01T23:00:21+00:00</published>
  <updated>2026-10-02T03:52:07+00:00</updated>
  <media:group>
   <media:title>Course-poursuite &amp; arrestation</media:title>
   <media:content url="https://www.youtube.com/v/8Xv5BLnXzgI?version=3" type="application/x-shockwave-flash" width="640" height="390"/>
   <media:thumbnail url="https://i1.ytimg.com/vi/8Xv5BLnXzgI/hqdefault.jpg" width="480" height="360"/>
   <media:description>Un short</media:description>
   <media:community><media:starRating count="184" average="5.00" min="1" max="5"/><media:statistics views="11441"/></media:community>
  </media:group>
 </entry>
 <entry>
  <id>yt:video:Rnz9mOyxk0k</id>
  <yt:videoId>Rnz9mOyxk0k</yt:videoId>
  <title>Soirée RP l&#39;épisode 2</title>
  <link rel="alternate" href="https://www.youtube.com/watch?v=Rnz9mOyxk0k"/>
  <published>2026-10-01T19:00:13+00:00</published>
  <media:group><media:thumbnail url="https://i3.ytimg.com/vi/Rnz9mOyxk0k/hqdefault.jpg" width="480" height="360"/><media:community><media:statistics views="15374"/></media:community></media:group>
 </entry>
</feed>`;

export const RSS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<!-- a comment <item> that is not one -->
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:media="http://search.yahoo.com/mrss/" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
  <title>Actus BRL</title>
  <link>https://brl.example/</link>
  <atom:link href="https://brl.example/feed" rel="self" type="application/rss+xml"/>
  <item>
    <title><![CDATA[Mise à jour 2.0 : <b>nouveaux</b> métiers]]></title>
    <link>https://brl.example/maj-2</link>
    <guid isPermaLink="false">brl-42</guid>
    <dc:creator>Staff</dc:creator>
    <pubDate>Thu, 01 Oct 2026 18:00:00 +0200</pubDate>
    <description>&lt;p&gt;Les &lt;em&gt;nouveautés&lt;/em&gt; &amp;amp; corrections&lt;/p&gt;&lt;img src="https://brl.example/maj.png"&gt;</description>
  </item>
  <item>
    <title>Sans guid</title>
    <link>https://brl.example/sans-guid</link>
    <enclosure url="https://brl.example/photo.jpg" type="image/jpeg" length="1000"/>
  </item>
</channel>
</rss>`;

export const ATOM_XML = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title type="text">Blog</title>
  <link href="https://blog.example/" rel="alternate"/>
  <link href="https://blog.example/atom.xml" rel="self"/>
  <entry>
    <title type="html">Premier &lt;i&gt;billet&lt;/i&gt;</title>
    <link href="https://blog.example/1" rel="alternate"/>
    <id>tag:blog.example,2026:1</id>
    <updated>2026-09-30T10:00:00Z</updated>
    <author><name>Alice</name></author>
    <summary type="html">&lt;p&gt;Bonjour&lt;/p&gt;</summary>
  </entry>
</feed>`;

test('entities: named, numeric and hexadecimal', () => {
	assert.equal(decodeEntities('a &amp; b &#39;c&#39; &#x2764; &eacute; &unknown;'), 'a & b \'c\' ❤ é &unknown;');
});

test('RSS 2.0: CDATA, escaped HTML, guid, image from the description or the enclosure, dates', () => {
	const feed = parseFeed(RSS_XML);
	assert.equal(feed.kind, 'rss');
	assert.equal(feed.title, 'Actus BRL');
	assert.equal(feed.link, 'https://brl.example/');
	assert.equal(feed.items.length, 2);
	const [first, second] = feed.items;
	assert.equal(first.id, 'brl-42');
	assert.equal(first.title, 'Mise à jour 2.0 : nouveaux métiers');
	assert.equal(first.description, 'Les nouveautés & corrections');
	assert.equal(first.image, 'https://brl.example/maj.png');
	assert.equal(first.author, 'Staff');
	assert.equal(first.publishedAt, Date.UTC(2026, 9, 1, 16, 0));
	assert.equal(second.id, 'https://brl.example/sans-guid', 'no guid: the link identifies the item');
	assert.equal(second.image, 'https://brl.example/photo.jpg');
	assert.equal(second.publishedAt, null);
});

test('Atom: alternate link, html title, author', () => {
	const feed = parseFeed(ATOM_XML);
	assert.equal(feed.kind, 'atom');
	assert.equal(feed.link, 'https://blog.example/');
	const [entry] = feed.items;
	assert.deepEqual([entry.id, entry.title, entry.link, entry.author, entry.description], ['tag:blog.example,2026:1', 'Premier billet', 'https://blog.example/1', 'Alice', 'Bonjour']);
	assert.equal(entry.publishedAt, Date.parse('2026-09-30T10:00:00Z'));
});

test('not a feed: clear error', () => {
	assert.throws(() => parseFeed('<html><body>Oups</body></html>'), /RSS ou Atom/);
	assert.throws(() => parseFeed('{"json":true}'), /RSS ou Atom/);
});

test('YouTube feed: videos and Shorts (/shorts/ link), thumbnail, views, channel name', async () => {
	const fetchImpl = async () => ({ ok: true, status: 200, text: async () => YOUTUBE_XML });
	const videos = await youtubeVideos({ fetchImpl }, 'UC_x5XG1OV2P6uZZ5FSM9Ttw');
	assert.deepEqual(videos.map(v => [v.id, v.short, v.title]), [['8Xv5BLnXzgI', true, 'Course-poursuite & arrestation'], ['Rnz9mOyxk0k', false, 'Soirée RP l\'épisode 2']]);
	assert.equal(videos[0].thumbnail, 'https://i1.ytimg.com/vi/8Xv5BLnXzgI/hqdefault.jpg');
	assert.equal(videos[0].viewers, 11441);
	assert.equal(videos[1].name, 'Brothers Life');
});

test('YouTube channel: UC id, @handle, /c/ and /user/ links resolved from the canonical link', async () => {
	const asked = [];
	const fetchImpl = async (url, init) => {
		asked.push([url, init.headers.Cookie]);
		return { ok: true, status: 200, text: async () => '<link rel="canonical" href="https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv">' };
	};
	assert.equal(await youtubeChannelId({ fetchImpl }, 'https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw'), 'UC_x5XG1OV2P6uZZ5FSM9Ttw');
	assert.equal(asked.length, 0);
	assert.equal(await youtubeChannelId({ fetchImpl }, '@BrothersLife'), 'UCabcdefghijklmnopqrstuv');
	assert.equal(await youtubeChannelId({ fetchImpl }, 'https://www.youtube.com/c/BrothersLife/videos'), 'UCabcdefghijklmnopqrstuv');
	assert.equal(await youtubeChannelId({ fetchImpl }, 'youtube.com/user/brl'), 'UCabcdefghijklmnopqrstuv');
	assert.deepEqual(asked.map(a => a[0]), ['https://www.youtube.com/@BrothersLife', 'https://www.youtube.com/c/BrothersLife', 'https://www.youtube.com/user/brl']);
	assert.ok(asked.every(a => a[1] === 'SOCS=CAI'), 'the EU consent wall is skipped');
	await assert.rejects(youtubeChannelId({ fetchImpl }, 'pas une chaîne'), /@nom/);
});
