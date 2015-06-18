'use strict';

var url = require('url');

var Entities = require('html-entities').XmlEntities;
var marked = require('marked');

marked.setOptions({
    tables: false,
    sanitize: true,
    smartLists: true
});


var makeRss = function(posts) {
    var entities = new Entities();

    var xml = [];
    var title = entities.encode('reddit new');
    var link = entities.encode('http://www.reddit.com/');
    xml.push('<?xml version="1.0"?>');
    xml.push('<rss version="2.0">');
    xml.push('<channel>');
    xml.push('<title>' + title + '</title>');
    xml.push('<link>' + link + '</link>');
    xml.push('<description>New posts on reddit</description>');
    xml.push('<lastBuildDate>' + (new Date().toUTCString()) + '</lastBuildDate>');
    xml.push('<ttl>25</ttl>');
    xml.push('<image>' +
             '<url>' + entities.encode('http://www.redditstatic.com/reddit.com.header.png') + '</url>' +
             '<title>' + title + '</title>' +
             '<link>' + link + '</link>' +
             '</image>');

    posts.reverse().forEach(function(post) {
        var itemLink = 'http://www.reddit.com' + post.permalink;

        var description = [];

        var urlParsed;
        if (!post.is_self) {
            urlParsed = url.parse(post.url, false, true);
        }

        var imageUrl;
        if (urlParsed) {
            if (/\.(png|jpe?g|gif|svg)$/i.test(urlParsed.pathname)) {
                imageUrl = post.url;
            } else if (urlParsed.host === 'imgur.com' && /^\/[a-z0-9]+$/i.test(urlParsed.pathname)) {
                imageUrl = 'http://i.imgur.com' + urlParsed.pathname + '.png';
            }
        }

        if (imageUrl) {
            description.push('<p><a href="' + post.url + '"><img src="' + imageUrl + '"/></a></p>');
        } else if (post.thumbnail && ['self', 'default'].indexOf(post.thumbnail) === -1) {
            description.push('<p><a href="' + (post.is_self ? itemLink : post.url) + '">' +
                             '<img src="' + post.thumbnail + '"/>' +
                             '</a></p>');
        }

        if (post.selftext) {
            description.push(marked(post.selftext));
        }

        if (urlParsed && !imageUrl) {
            description.push('<p><a href="' + post.url + '">[' + post.url + ']</a></p>');
        }

        description.push('<p>');
        description.push('<big>');
        description.push('<a href="' + itemLink + '">[' +
                         post.num_comments + ' comment' +
                         (post.num_comments !== 1 ? 's' : '') +
                         ']</a> ');
        description.push('</big>');
        description.push('[' + (post.score > 0 ? '+' : '') + post.score + ']');
        description.push('</p>');

        var itemLinkEncoded = entities.encode(itemLink);
        xml.push('<item>');

        var postTitle = post.title;
        if (/[^\.]\.$/.test(postTitle)) {
            postTitle = postTitle.slice(0, -1);
        }
        postTitle += ' — ' + post.subreddit;
        xml.push('<title>' + entities.encode(postTitle) + '</title>');

        xml.push('<link>' + itemLinkEncoded + '</link>');
        xml.push('<description>' + entities.encode(description.join('')) + '</description>');
        xml.push('<guid isPermalink="true">' + itemLinkEncoded + '</guid>');
        xml.push('<pubDate>' + (new Date(post.created_utc * 1000).toUTCString()) + '</pubDate>');
        xml.push('</item>');
    });

    xml.push('</channel>');
    xml.push('</rss>');

    return xml.join('');
};

module.exports = makeRss;
