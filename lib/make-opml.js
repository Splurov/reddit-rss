'use strict';

var Entities = require('html-entities').XmlEntities;

var makeOpml = function(subreddits, rssPublicBaseUrl) {
    var entities = new Entities();
    var baseUrl = String(rssPublicBaseUrl || '');
    if (baseUrl.charAt(baseUrl.length - 1) !== '/') {
        baseUrl += '/';
    }

    var xml = [];
    xml.push('<?xml version="1.0"?>');
    xml.push('<opml version="2.0">');
    xml.push('<head>');
    xml.push('<title>reddit-rss subscriptions</title>');
    xml.push('<dateCreated>' + entities.encode(new Date().toUTCString()) + '</dateCreated>');
    xml.push('</head>');
    xml.push('<body>');

    subreddits.forEach(function(subreddit) {
        var name = subreddit.displayName;
        var filename = subreddit.filename;
        var xmlUrl = baseUrl + filename;
        var htmlUrl = 'https://www.reddit.com/r/' + name + '/';
        var label = 'r/' + name;

        xml.push(
            '<outline type="rss" text="' + entities.encode(label) +
            '" title="' + entities.encode(label) +
            '" xmlUrl="' + entities.encode(xmlUrl) +
            '" htmlUrl="' + entities.encode(htmlUrl) + '" />'
        );
    });

    xml.push('</body>');
    xml.push('</opml>');

    return xml.join('');
};

module.exports = makeOpml;
