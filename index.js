'use strict';

var fs = require('fs');

var Snoocore = require('snoocore');
var Entities = require('html-entities').XmlEntities;
var marked = require('marked');
var numpad = require('numpad');

var storageFilePath = './storage.json';

var packageJson = require('./package.json');
var storage = require(storageFilePath);
var config = require('./config.json');

marked.setOptions({
    gfm: true,
    tables: false,
    breaks: false,
    pedantic: false,
    sanitize: true,
    smartLists: true,
    smartypants: false
});

var currentTime = Math.round(new Date().getTime() / 1000);
var maxTime = currentTime - (config.maxHoursAgo * 3600);

var before = storage.before || null;
var posts = [];
var requests = 0;


var reddit = new Snoocore({
    'userAgent': packageJson.name + '/' + packageJson.version + ' by ' + config.username
});

var getRssDate = function(date) {
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    return days[date.getUTCDay()] + ', ' +
           numpad(date.getUTCDate(), 2) + ' ' +
           months[date.getUTCMonth()] + ' ' +
           date.getUTCFullYear() + ' ' +
           numpad(date.getUTCHours(), 2) + ':' +
           numpad(date.getUTCMinutes(), 2) + ':' +
           numpad(date.getUTCSeconds(), 2) + ' ' +
           'GMT';
};

var makeRss = function() {
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
    xml.push('<lastBuildDate>' + getRssDate(new Date()) + '</lastBuildDate>');
    xml.push('<ttl>25</ttl>');
    xml.push('<image>' +
             '<url>' + entities.encode('http://www.redditstatic.com/reddit.com.header.png') + '</url>' +
             '<title>' + title + '</title>' +
             '<link>' + link + '</link>' +
             '</image>');

    storage.posts.reverse().forEach(function(post) {
        var itemLink = 'http://www.reddit.com' + post.permalink;

        var description = [];

        var isImageUrl = false;
        if (!post.is_self && /\.(png|jpg|gif|jpeg)$/i.test(post.url)) {
            isImageUrl = true;
            description.push('<p><a href="' + post.url + '"><img src="' + post.url + '" width="320"/></a></p>');
        } else if (post.thumbnail && ['self', 'default'].indexOf(post.thumbnail) === -1) {
            description.push('<p><a href="' + (post.is_self ? itemLink : post.url) + '"><img src="' + post.thumbnail + '"/></a></p>');
        }
        if (post.selftext) {
            description.push(marked(post.selftext));
        }
        description.push('<p>');
        description.push('<big>');
        if (!post.is_self && !isImageUrl) {
            description.push('<a href="' + post.url + '">[external link]</a> ');
        }
        description.push('<a href="' + itemLink + '">[' +
                         post.num_comments + ' comment' +
                         (post.num_comments !== 1 ? 's' : '') +
                         ']</a> ');
        description.push('</big>');
        description.push('[' + (post.score > 0 ? '+' : '') + post.score + ']');
        description.push('</p>');

        var itemLinkEncoded = entities.encode(itemLink);
        xml.push('<item>');
        xml.push('<title>' + entities.encode('[' + post.subreddit + '] ' + post.title) + '</title>');
        xml.push('<link>' + itemLinkEncoded + '</link>');
        xml.push('<description>' + entities.encode(description.join('')) + '</description>');
        xml.push('<guid isPermalink="true">' + itemLinkEncoded + '</guid>');
        xml.push('<pubDate>' + getRssDate(new Date(post.created_utc * 1000)) + '</pubDate>');
        xml.push('</item>');
    });

    xml.push('</channel>');
    xml.push('</rss>');

    fs.writeFileSync(config.rssFilePath, xml.join(''));
};

var finish = function() {
    var allPosts = (storage.posts || []).concat(posts);
    allPosts.sort(function(a, b) {
        return a.created_utc - b.created_utc;
    });
    if (allPosts.length > config.maxRssItems) {
        allPosts = allPosts.slice(-config.maxRssItems);
    }
    storage.posts = allPosts;

    makeRss();

    storage.before = before;
    fs.writeFileSync(storageFilePath, JSON.stringify(storage));
    console.log('[info] Successfully updated, new before: ' +
                before +
                ', requests: ' +
                requests +
                ', items length: ' +
                posts.length);
};

var getUpdates = function() {
    requests++;
    if (requests > config.maxRequests) {
        console.error('[ERROR] Too many requests, before: ' + before);
        return;
    }

    var isFinish = false;

    var params = {
        'limit': 100
    };
    if (before) {
        params.before = before;
    }

    reddit.new(params).then(function(items) {
        if (!items.data || !items.data.children || !items.data.children.length) {
            console.error('[ERROR] No data, before: ' + before + ', requests: ' + requests);
            return;
        }

        var itemsLength = items.data.children.length;
        while (--itemsLength) {
            var item = items.data.children.pop().data;
            if (item.created_utc > maxTime) {
                isFinish = true;
                break;
            } else {
                before = item.name;
                if (item.score >= config.minScore || item.num_comments >= config.minComments) {
                    posts.push(item);
                }
            }
        }

        if (isFinish) {
            finish();
        } else {
            getUpdates();
        }
    });
};


reddit.auth(Snoocore.oauth.getAuthData('script', {
    consumerKey: config.consumerKey,
    consumerSecret: config.consumerSecret,
    username: config.username,
    password: config.password,
    scope: ['identity', 'read']
})).then(function() {
    getUpdates();
});
