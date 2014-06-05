'use strict';

var fs = require('fs');
var util = require('util');
var url = require('url');

var Snoocore = require('snoocore');
var Entities = require('html-entities').XmlEntities;
var marked = require('marked');

var packageJson = require('./package.json');
var config = require('./config.json');
var storage = require(config.storageFilePath);


marked.setOptions({
    tables: false,
    sanitize: true,
    smartLists: true
});

var reddit = new Snoocore({
    'userAgent': packageJson.name + '/' + packageJson.version + ' by ' + config.username
});


var maxTime = Math.round(new Date().getTime() / 1000) - (config.maxHoursAgo * 3600);
var before = storage.before || null;
var posts = [];
var requests = 0;


var logger = {
    '_log': function(type, message) {
        util.log(util.format('[%s] %s (before: %s) (posts: %s) (requests: %s) (max time: %s)',
                             type,
                             message,
                             before,
                             posts.length,
                             requests,
                             maxTime));
    },
    'logError': function(message) {
        this._log('ERROR', message);
    },
    'logInfo': function(message) {
        this._log('info', message);
    },
    'logDebug': function(message) {
        if (config.isLogDebug) {
            this._log('debug', message);
        }
    }
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
    xml.push('<lastBuildDate>' + (new Date().toUTCString()) + '</lastBuildDate>');
    xml.push('<ttl>25</ttl>');
    xml.push('<image>' +
             '<url>' + entities.encode('http://www.redditstatic.com/reddit.com.header.png') + '</url>' +
             '<title>' + title + '</title>' +
             '<link>' + link + '</link>' +
             '</image>');

    storage.posts.reverse().forEach(function(post) {
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
            description.push('<p><a href="' + post.url + '"><img src="' + imageUrl + '" width="320"/></a></p>');
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
        if (post.title.toLowerCase().indexOf(post.subreddit.toLowerCase()) === -1) {
            postTitle += ' — ' + post.subreddit;
        }
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

var finish = function() {
    var allPosts = (storage.posts || []).concat(posts);
    allPosts.sort(function(a, b) {
        return a.created_utc - b.created_utc;
    });
    if (allPosts.length > config.maxRssItems) {
        allPosts = allPosts.slice(-config.maxRssItems);
    }
    storage.posts = allPosts;

    var rssContent = makeRss();
    fs.writeFileSync(config.rssFilePath, rssContent);

    storage.before = before;
    fs.writeFileSync(config.storageFilePath, JSON.stringify(storage));
    logger.logInfo('Successfully updated');
};

var getUpdates = function() {
    requests++;
    if (requests > config.maxRequests) {
        logger.logError('Too many requests');
        return;
    }

    var params = {
        'limit': 100
    };
    if (before) {
        params.before = before;
    }

    logger.logDebug('Get updates');

    reddit.new(params).then(function(items) {
        var itemsLength;
        try {
            itemsLength = items.data.children.length;
        } catch(e) {
            logger.logError('No data');
            return;
        }

        if (itemsLength === 0) {
            logger.logInfo('No items, trying to obtain before from storage');
            if (storage.posts.length >= 2) {
                before = storage.posts[1].name;
                logger.logInfo('New before');
                getUpdates();
            } else {
                logger.logError('Can not obtain before from storage');
                finish();
            }
            return;
        }

        for (var i = itemsLength - 1; i >= 0; i--) {
            var item = items.data.children[i].data;
            if (item.created_utc > maxTime) {
                logger.logDebug(util.format('Finish on item {time: %s} {item name: %s}', item.created_utc, item.name));
                finish();
                return;
            }

            before = item.name;
            if (item.score >= config.minScore || item.num_comments >= config.minComments) {
                posts.push(item);
            }
        }

        getUpdates();
    });
};


reddit.auth(Snoocore.oauth.getAuthData('script', {
    consumerKey: config.consumerKey,
    consumerSecret: config.consumerSecret,
    username: config.username,
    password: config.password,
    scope: ['read']
})).then(function() {
    getUpdates();
});
