'use strict';

var htmlEntities = require('html-entities');

var xmlEntityOptions = {'level': 'xml'};
var encodeXml = function(text) {
    return htmlEntities.encode(text, xmlEntityOptions);
};

var makeOpml = function(subreddits, rssPublicBaseUrl) {
    var baseUrl = String(rssPublicBaseUrl || '');
    if (baseUrl.charAt(baseUrl.length - 1) !== '/') {
        baseUrl += '/';
    }

    var xml = [];
    xml.push('<?xml version="1.0"?>');
    xml.push('<opml version="2.0">');
    xml.push('<head>');
    xml.push('<title>reddit-rss subscriptions</title>');
    xml.push('<dateCreated>' + encodeXml(new Date().toUTCString()) + '</dateCreated>');
    xml.push('</head>');
    xml.push('<body>');

    subreddits.forEach(function(subreddit) {
        var name = subreddit.displayName;
        var filename = subreddit.filename;
        var xmlUrl = baseUrl + filename;
        var htmlUrl = 'https://www.reddit.com/r/' + name + '/';
        var label = 'r/' + name;

        xml.push(
            '<outline type="rss" text="' + encodeXml(label) +
            '" title="' + encodeXml(label) +
            '" xmlUrl="' + encodeXml(xmlUrl) +
            '" htmlUrl="' + encodeXml(htmlUrl) + '" />'
        );
    });

    xml.push('</body>');
    xml.push('</opml>');

    return xml.join('');
};

module.exports = makeOpml;
