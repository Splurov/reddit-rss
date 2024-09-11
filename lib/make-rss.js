'use strict';

var url = require('url');

var Entities = require('html-entities').XmlEntities;

var makeRss = function(posts) {
    var commonUrls = {};
    posts.forEach(function(post) {
        if (post.is_self) {
            return;
        }

        if (!commonUrls[post.url]) {
            commonUrls[post.url] = {
                posts: [],
                isProcessed: false
            };
        }

        commonUrls[post.url].posts.push(post);
    });

    Object.keys(commonUrls).forEach(function(commonUrl) {
        if (commonUrls[commonUrl].posts.length < 2) {
            return;
        }

        commonUrls[commonUrl].posts.sort(function(a, b) {
            return b.num_comments - a.num_comments;
        });
    });



    var entities = new Entities();

    var xml = [];
    var title = entities.encode('reddit new');
    var link = entities.encode('https://reddit.com/');
    xml.push('<?xml version="1.0"?>');
    xml.push('<rss version="2.0">');
    xml.push('<channel>');
    xml.push('<title>' + title + '</title>');
    xml.push('<link>' + link + '</link>');
    xml.push('<description>New posts on reddit</description>');
    xml.push('<lastBuildDate>' + (new Date().toUTCString()) + '</lastBuildDate>');
    xml.push('<ttl>25</ttl>');
    xml.push('<image>' +
             '<url>' + entities.encode('https://www.redditstatic.com/reddit.com.header.png') + '</url>' +
             '<title>' + title + '</title>' +
             '<link>' + link + '</link>' +
             '</image>');

    posts.reverse().forEach(function(postSource) {
        if (!postSource.is_self && commonUrls[postSource.url].isProcessed) {
            return;
        }
        
        var description = [];

        var linkPosts = [postSource];
        if (!postSource.is_self && commonUrls[postSource.url].posts.length > 1) {
            commonUrls[postSource.url].isProcessed = true;
            linkPosts = commonUrls[postSource.url].posts;
        }

        var post = linkPosts[0];

        if (post.secure_media_embed && post.secure_media_embed.content) {
            description.push(`<p>${post.secure_media_embed.content}</p>`);
        } else if (post.preview && post.preview.images && post.preview.images.length > 0) {
            post.preview.images.forEach(function(image) {
                var suitable = image.resolutions[image.resolutions.length - 1];
                description.push(`<p><img src="${suitable.url}"/></p>`);
            });
        } else if (post.gallery_data && post.gallery_data.items.length > 0) {
            post.gallery_data.items.forEach(function(gallery_item) {
                var image = post.media_metadata[gallery_item.media_id];
                if (image.e !== 'Image') {
                    return;
                }

                var suitable = image.p[image.p.length - 1];
                description.push(`<p><img src="${suitable.u}"/></p>`);
            });
        }

        if (post.selftext_html) {
            description.push(Entities.decode(post.selftext_html));
        }

        linkPosts.forEach(function(linkPost) {
            description.push(`<p>
                <a href="https://reddit.com${linkPost.permalink}">
                    ${linkPost.num_comments + (linkPosts.length > 1 ? ' — ' + linkPost.subreddit : '')}
                    |
                    ${(linkPost.score > 0 ? '+' : '') + linkPost.score}
                </a>
            </p>`);
        });

        xml.push('<item>');

        var postTitle = post.subreddit + ' / ' + post.title.replace(/\.$/, '');
        postTitle += ' (' + post.num_comments + ' | ' + (post.score > 0 ? '+' : '') + post.score + ')';
        xml.push('<title>' + entities.encode(postTitle) + '</title>');

        xml.push('<link>' + entities.encode('https://reddit.com' + post.permalink) + '</link>');
        xml.push('<author>' + post.subreddit + '</author>');
        xml.push('<description>' + entities.encode(description.join('')) + '</description>');
        xml.push('<guid>' + post.id + '</guid>');
        xml.push('<pubDate>' + (new Date(post.created_utc * 1000).toUTCString()) + '</pubDate>');
        xml.push('</item>');
    });

    xml.push('</channel>');
    xml.push('</rss>');

    return xml.join('');
};

module.exports = makeRss;
