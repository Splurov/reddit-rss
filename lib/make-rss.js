'use strict';

var htmlEntities = require('html-entities');

var xmlEntityOptions = {'level': 'xml'};
var encodeXml = function(text) {
    return htmlEntities.encode(text, xmlEntityOptions);
};
var decodeXml = function(text) {
    return htmlEntities.decode(text, xmlEntityOptions);
};

var makeRss = function(subreddit, posts) {
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



    var xml = [];
    var subredditTitle = String(subreddit || 'reddit');
    var title = encodeXml('reddit / r/' + subredditTitle);
    var link = encodeXml('https://www.reddit.com/r/' + subredditTitle + '/');
    xml.push('<?xml version="1.0"?>');
    xml.push('<rss version="2.0">');
    xml.push('<channel>');
    xml.push('<title>' + title + '</title>');
    xml.push('<link>' + link + '</link>');
    xml.push('<description>' + encodeXml('New posts in r/' + subredditTitle) + '</description>');
    xml.push('<lastBuildDate>' + (new Date().toUTCString()) + '</lastBuildDate>');
    xml.push('<ttl>25</ttl>');
    xml.push('<image>' +
             '<url>' + encodeXml('https://www.redditstatic.com/reddit.com.header.png') + '</url>' +
             '<title>' + title + '</title>' +
             '<link>' + link + '</link>' +
             '</image>');

    posts.slice().reverse().forEach(function(postSource) {
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
        } else if (post.gallery_data && post.gallery_data.items && post.gallery_data.items.length > 0 && post.media_metadata) {
            post.gallery_data.items.forEach(function (gallery_item) {
                var image = post.media_metadata[gallery_item.media_id];
                if (!image || image.e !== 'Image') {
                    return;
                }

                var suitable = image.p[image.p.length - 1];
                if (!suitable) {
                    return;
                }
                description.push(`<p><img src="${suitable.u}"/></p>`);
            });
        } else if (post.preview && post.preview.images && post.preview.images.length > 0) {
            post.preview.images.forEach(function (image) {
                var suitable;
                if (image.resolutions && image.resolutions.length > 0) {
                    suitable = image.resolutions[image.resolutions.length - 1];
                } else {
                    suitable = image.source;
                }
                description.push(`<p><img src="${suitable.url}"/></p>`);
            });
        }

        if (post.selftext_html) {
            description.push(decodeXml(post.selftext_html));
        }

        if (post.domain && post.domain !== 'reddit.com' && !post.is_reddit_media_domain && !post.is_self) {
            description.push(`<p><a href="${post.url}">${post.domain}</a></p>`);
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

        var postTitle = post.subreddit + ' / ' + String(post.title || '').replace(/\.$/, '');
        postTitle += ' (' + post.num_comments + ' | ' + (post.score > 0 ? '+' : '') + post.score + ')';
        xml.push('<title>' + encodeXml(postTitle) + '</title>');

        xml.push('<link>' + encodeXml('https://reddit.com' + post.permalink) + '</link>');
        xml.push('<author>' + encodeXml(post.subreddit || subredditTitle) + '</author>');
        xml.push('<description>' + encodeXml(description.join('')) + '</description>');
        xml.push('<guid>' + post.id + '</guid>');
        xml.push('<pubDate>' + (new Date(post.created_utc * 1000).toUTCString()) + '</pubDate>');
        xml.push('</item>');
    });

    xml.push('</channel>');
    xml.push('</rss>');

    return xml.join('');
};

module.exports = makeRss;
