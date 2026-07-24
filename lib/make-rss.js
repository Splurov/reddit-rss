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

var getPostGroups = function(postsBySubreddit) {
    var postsByKey = {};
    var postKeysByLookupKey = {};
    var allPosts = [];
    var groupParents = {};
    var crosspostParentKeys = {};
    var unmatchedCrosspostKeys = {};

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

            if (postsByKey[postKey]) {
                return;
            }

            postsByKey[postKey] = post;
            groupParents[postKey] = postKey;
            allPosts.push(post);
            getPostLookupKeys(post).forEach(function(lookupKey) {
                postKeysByLookupKey[lookupKey] = postKey;
            });
        });
    });

    var getGroupRoot = function(postKey) {
        if (groupParents[postKey] !== postKey) {
            groupParents[postKey] = getGroupRoot(groupParents[postKey]);
        }
        return groupParents[postKey];
    };

    var mergeGroups = function(firstPostKey, secondPostKey) {
        var firstRoot = getGroupRoot(firstPostKey);
        var secondRoot = getGroupRoot(secondPostKey);
        if (firstRoot !== secondRoot) {
            groupParents[secondRoot] = firstRoot;
        }
    };

    allPosts.forEach(function(crosspost) {
        if (!crosspost.crosspost_parent_list || crosspost.crosspost_parent_list.length === 0) {
            return;
        }

        var parent = crosspost.crosspost_parent_list[0];
        var parentKey;
        getPostLookupKeys(parent).some(function(lookupKey) {
            parentKey = postKeysByLookupKey[lookupKey];
            return Boolean(parentKey);
        });

        var crosspostKey = getPostKey(crosspost);
        if (!crosspostKey) {
            return;
        }

        if (!parentKey || parentKey === crosspostKey) {
            unmatchedCrosspostKeys[crosspostKey] = true;
            return;
        }

        crosspostParentKeys[crosspostKey] = parentKey;
        mergeGroups(parentKey, crosspostKey);
    });

    var postsByUrl = {};
    allPosts.forEach(function(post) {
        var postKey = getPostKey(post);
        if (post.is_self || unmatchedCrosspostKeys[postKey]) {
            return;
        }

        var urlKey = '$' + String(post.url);
        if (postsByUrl[urlKey]) {
            mergeGroups(postsByUrl[urlKey], postKey);
            return;
        }

        postsByUrl[urlKey] = postKey;
    });

    var groupsByRoot = {};
    allPosts.forEach(function(post) {
        var root = getGroupRoot(getPostKey(post));
        if (!groupsByRoot[root]) {
            groupsByRoot[root] = [];
        }
        groupsByRoot[root].push(post);
    });

    var groupsByPostKey = {};
    Object.keys(groupsByRoot).forEach(function(root) {
        var groupPosts = groupsByRoot[root];
        var primaryPosts = groupPosts.filter(function(post) {
            return !crosspostParentKeys[getPostKey(post)];
        });
        primaryPosts.sort(function(a, b) {
            return b.num_comments - a.num_comments;
        });

        var post = primaryPosts[0] || groupPosts[0];
        var linkPosts = [post].concat(groupPosts.filter(function(groupPost) {
            return groupPost !== post;
        }));
        linkPosts.sort(function(a, b) {
            if (a === post) {
                return -1;
            }
            if (b === post) {
                return 1;
            }
            return b.num_comments - a.num_comments;
        });

        var group = {
            'post': post,
            'postKey': getPostKey(post),
            'linkPosts': linkPosts
        };
        linkPosts.forEach(function(linkPost) {
            groupsByPostKey[getPostKey(linkPost)] = group;
        });
    });

    return groupsByPostKey;
};

var makeRss = function(subreddit, posts, communityIcon, allPostsBySubreddit) {
    var postGroups = getPostGroups(allPostsBySubreddit || {'current': posts});

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
        var group = postGroups[getPostKey(postSource)];
        if (!group || group.postKey !== getPostKey(postSource)) {
            return;
        }

        var post = group.post;
        var linkPosts = group.linkPosts;
        var description = [];

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
                &nbsp;
                <a href="https://old.reddit.com${linkPost.permalink}">(old)</a>
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
