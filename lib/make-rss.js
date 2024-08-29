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

    posts.reverse().forEach(function(post) {
        if (!post.is_self && commonUrls[post.url].isProcessed) {
            return;
        }
        var itemLink = 'https://reddit.com' + post.permalink;

        var description = [];

        var urlParsed;
        var linkPosts = [post];
        if (!post.is_self) {
            urlParsed = url.parse(post.url, false, true);

            if (commonUrls[post.url].posts.length > 1) {
                commonUrls[post.url].isProcessed = true;
                linkPosts = commonUrls[post.url].posts;
            }
        }

        var imageUrl;
        if (urlParsed) {
            if (/\.(png|jpe?g|gif|svg)$/i.test(urlParsed.pathname)) {
                imageUrl = linkPosts[0].url;
            } else if (urlParsed.host === 'imgur.com' && /^\/[a-z0-9]+$/i.test(urlParsed.pathname)) {
                imageUrl = 'https://i.imgur.com' + urlParsed.pathname + '.png';
            }
        }

        if (imageUrl) {
            description.push('<p><a href="' + linkPosts[0].url + '"><img src="' + imageUrl + '"/></a></p>');
        } else if (linkPosts[0].thumbnail && ['self', 'default'].indexOf(linkPosts[0].thumbnail) === -1) {
            description.push('<p><a href="' + (linkPosts[0].is_self ? itemLink : linkPosts[0].url) + '">' +
                             '<img src="' + linkPosts[0].thumbnail + '"/>' +
                             '</a></p>');
        }

        if (linkPosts[0].selftext_html) {
            description.push(Entities.decode(linkPosts[0].selftext_html));
        }

        if (urlParsed && !imageUrl) {
            description.push('<p><a href="' + linkPosts[0].url + '">[' + linkPosts[0].url + ']</a></p>');
        }

        linkPosts.forEach(function(linkPost) {
            var subredditName = linkPost.subreddit.display_name ? linkPost.subreddit.display_name : linkPost.subreddit;

            var desktop = 'https://reddit.com' + linkPost.permalink;
            description.push('<p>');
            description.push('<big>');
            description.push(
                '<a href="' + desktop + '">[' +
                linkPost.num_comments +
                (linkPosts.length > 1 ? ' — ' + subredditName : '') +
                ']</a> '
            );
            description.push('</big>');
            description.push('[' + (linkPost.score > 0 ? '+' : '') + linkPost.score + ']');
            description.push('</p>');
        });

        var itemLinkEncoded = entities.encode(itemLink);
        xml.push('<item>');

        var subredditName = linkPosts[0].subreddit.display_name ? linkPosts[0].subreddit.display_name : linkPosts[0].subreddit;

        var postTitle = linkPosts[0].title;
        if (/[^\.]\.$/.test(postTitle)) {
            postTitle = postTitle.slice(0, -1);
        }
        postTitle += ' — ' + subredditName;
        postTitle += ' (' + linkPosts[0].num_comments + ' / ' + (linkPosts[0].score > 0 ? '+' : '') + linkPosts[0].score + ')';
        xml.push('<title>' + entities.encode(postTitle) + '</title>');

        xml.push('<link>' + itemLinkEncoded + '</link>');
        xml.push('<description>' + entities.encode(description.join('')) + '</description>');
        xml.push('<guid isPermalink="true">' + linkPosts[0].id + '</guid>');
        xml.push('<pubDate>' + (new Date(linkPosts[0].created_utc * 1000).toUTCString()) + '</pubDate>');
        xml.push('</item>');
    });

    xml.push('</channel>');
    xml.push('</rss>');

    return xml.join('');
};

module.exports = makeRss;
