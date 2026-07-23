'use strict';

var htmlEntities = require('html-entities');

var xmlEntityOptions = {'level': 'xml'};
var encodeXml = function(text) {
    return htmlEntities.encode(text, xmlEntityOptions);
};
var decodeXml = function(text) {
    return htmlEntities.decode(text, xmlEntityOptions);
};

var DEFAULT_CHANNEL_IMAGE_URL = 'https://www.redditstatic.com/shreddit/assets/favicon/192x192.png';

var getPostKey = function(post) {
    if (!post || typeof post !== 'object') {
        return null;
    }

    if (post.name) {
        return String(post.name);
    }

    if (post.id) {
        return String(post.id);
    }

    return null;
};

var getPostLookupKeys = function(post) {
    var keys = [];
    var postKey = getPostKey(post);
    if (postKey) {
        keys.push(postKey);
    }

    if (post && post.name && post.id && String(post.name) !== String(post.id)) {
        keys.push(String(post.id));
    }

    return keys;
};

var buildCrosspostIndex = function(postsBySubreddit) {
    var postsByKey = {};
    var allPosts = [];

    Object.keys(postsBySubreddit || {}).forEach(function(subreddit) {
        var subredditPosts = postsBySubreddit[subreddit];
        if (!Array.isArray(subredditPosts)) {
            return;
        }

        subredditPosts.forEach(function(post) {
            var postKey = getPostKey(post);
            if (!postKey) {
                return;
            }

            allPosts.push(post);
            getPostLookupKeys(post).forEach(function(lookupKey) {
                postsByKey[lookupKey] = postKey;
            });
        });
    });

    var crosspostKeys = {};
    var crosspostsByParentKey = {};
    allPosts.forEach(function(crosspost) {
        if (!crosspost.crosspost_parent_list || crosspost.crosspost_parent_list.length === 0) {
            return;
        }

        var parent = crosspost.crosspost_parent_list[0];
        var parentKey;
        getPostLookupKeys(parent).some(function(lookupKey) {
            parentKey = postsByKey[lookupKey];
            return Boolean(parentKey);
        });

        var crosspostKey = getPostKey(crosspost);
        if (!parentKey || !crosspostKey || parentKey === crosspostKey) {
            return;
        }

        crosspostKeys[crosspostKey] = true;
        if (!crosspostsByParentKey[parentKey]) {
            crosspostsByParentKey[parentKey] = [];
        }
        crosspostsByParentKey[parentKey].push(crosspost);
    });

    return {
        'crosspostKeys': crosspostKeys,
        'crosspostsByParentKey': crosspostsByParentKey
    };
};

var makeRss = function(subreddit, posts, communityIcon, crosspostIndex) {
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
    var channelImageUrl = communityIcon ? encodeXml(decodeXml(String(communityIcon))) : DEFAULT_CHANNEL_IMAGE_URL;
    xml.push('<?xml version="1.0"?>');
    xml.push('<rss version="2.0">');
    xml.push('  <channel>');
    xml.push('    <title>' + title + '</title>');
    xml.push('    <link>' + link + '</link>');
    xml.push('    <description>' + encodeXml('New posts in r/' + subredditTitle) + '</description>');
    xml.push('    <lastBuildDate>' + (new Date().toUTCString()) + '</lastBuildDate>');
    xml.push('    <ttl>25</ttl>');
    xml.push('    <image>');
    xml.push('      <url>' + channelImageUrl + '</url>');
    xml.push('      <title>' + title + '</title>');
    xml.push('      <link>' + link + '</link>');
    xml.push('    </image>');

    posts.slice().reverse().forEach(function(postSource) {
        if (crosspostIndex && crosspostIndex.crosspostKeys[getPostKey(postSource)]) {
            return;
        }

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
        if (crosspostIndex) {
            linkPosts.slice().forEach(function(linkPost) {
                var crossposts = crosspostIndex.crosspostsByParentKey[getPostKey(linkPost)];
                if (crossposts) {
                    linkPosts = linkPosts.concat(crossposts);
                }
            });
        }

        var previewPost = post;
        if (post.crosspost_parent_list && post.crosspost_parent_list.length > 0) {
            previewPost = post.crosspost_parent_list[0];
        }

        if (previewPost.secure_media_embed && previewPost.secure_media_embed.content) {
            description.push(`<p>${decodeXml(previewPost.secure_media_embed.content)}</p>`);
        } else if (previewPost.gallery_data && previewPost.gallery_data.items && previewPost.gallery_data.items.length > 0 && previewPost.media_metadata) {
            previewPost.gallery_data.items.forEach(function (gallery_item) {
                var image = previewPost.media_metadata[gallery_item.media_id];
                if (!image || image.e !== 'Image') {
                    return;
                }

                var suitable = image.p[image.p.length - 1];
                if (!suitable) {
                    return;
                }
                description.push(`<p><img src="${suitable.u}"/></p>`);
            });
        } else if (previewPost.preview && previewPost.preview.images && previewPost.preview.images.length > 0) {
            previewPost.preview.images.forEach(function (image) {
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

        xml.push('    <item>');

        var postTitle = post.subreddit + ' / ' + String(post.title || '').replace(/\.$/, '');
        postTitle += ' (' + post.num_comments + ' | ' + (post.score > 0 ? '+' : '') + post.score + ')';
        xml.push('      <title>' + encodeXml(postTitle) + '</title>');

        xml.push('      <link>' + encodeXml('https://reddit.com' + post.permalink) + '</link>');
        xml.push('      <author>' + encodeXml(post.subreddit || subredditTitle) + '</author>');
        xml.push('      <description>' + encodeXml(description.join('')) + '</description>');
        xml.push('      <guid>' + post.id + '</guid>');
        xml.push('      <pubDate>' + (new Date(post.created_utc * 1000).toUTCString()) + '</pubDate>');
        xml.push('    </item>');
    });

    xml.push('  </channel>');
    xml.push('</rss>');

    return xml.join('\n') + '\n';
};

module.exports = makeRss;
module.exports.buildCrosspostIndex = buildCrosspostIndex;
