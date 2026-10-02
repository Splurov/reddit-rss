'use strict';

var htmlEntities = require('html-entities');
var normalizeSubreddit = require('./storage').normalizeSubreddit;

var xmlEntityOptions = {'level': 'xml'};
var encodeXml = function(text) {
    return htmlEntities.encode(text, xmlEntityOptions);
};
var decodeXml = function(text) {
    return htmlEntities.decode(text, xmlEntityOptions);
};

var getSuitablePreviewImage = function(image) {
    if (image.resolutions && image.resolutions.length > 0) {
        return image.resolutions[image.resolutions.length - 1];
    }

    return image.source;
};

var makeImageHtml = function(url, image) {
    var width = image && (image.width || image.x);
    var height = image && (image.height || image.y);
    var size = '';
    if (typeof width === 'number' && width > 0 && typeof height === 'number' && height > 0) {
        size = ` width="${width}" height="${height}"`;
    }

    return `<img src="${url}"${size}/>`;
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

        if (unmatchedCrosspostKeys[getPostKey(post)]) {
            var unmatchedCrosspostParent = post.crosspost_parent_list[0];
            if (unmatchedCrosspostParent.permalink && unmatchedCrosspostParent.subreddit &&
                typeof unmatchedCrosspostParent.num_comments === 'number' && typeof unmatchedCrosspostParent.score === 'number') {
                linkPosts.push(unmatchedCrosspostParent);
            }
        }

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
    var postsBySubreddit = allPostsBySubreddit || {'current': posts};
    var postGroups = getPostGroups(postsBySubreddit);

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
        var postSourceKey = getPostKey(postSource);
        var group = postGroups[postSourceKey];
        if (!group || group.postKey !== postSourceKey) {
            return;
        }

        var parent = postSource.crosspost_parent_list && postSource.crosspost_parent_list[0];
        var parentSubreddit = parent && normalizeSubreddit(parent.subreddit);
        if (parentSubreddit && Object.prototype.hasOwnProperty.call(postsBySubreddit, parentSubreddit)) {
            return;
        }

        var post = group.post;
        var linkPosts = group.linkPosts;
        var description = [];
        if (typeof post.link_flair_text === 'string' && post.link_flair_text.length > 0) {
            description.push(`<p>[${encodeXml(post.link_flair_text)}]</p>`);
        }

        var hasCrosspostParent = post.crosspost_parent_list && post.crosspost_parent_list.length > 0;
        var previewPost = hasCrosspostParent ? post.crosspost_parent_list[0] : post;
        var redditVideo = (previewPost.secure_media && previewPost.secure_media.reddit_video) ||
            (previewPost.media && previewPost.media.reddit_video);

        if (redditVideo && redditVideo.fallback_url) {
            var videoPreview;
            if (previewPost.preview && previewPost.preview.images && previewPost.preview.images.length > 0) {
                videoPreview = getSuitablePreviewImage(previewPost.preview.images[0]);
            }

            var poster = videoPreview ? ` poster="${videoPreview.url}"` : '';
            var videoFallback = videoPreview ? makeImageHtml(videoPreview.url, videoPreview) : `<a href="${redditVideo.fallback_url}">Video</a>`;
            description.push(`<p><video controls preload="metadata"${poster}><source src="${redditVideo.fallback_url}" type="video/mp4"/>${videoFallback}</video></p>`);
        } else if (previewPost.secure_media_embed && previewPost.secure_media_embed.content) {
            description.push(`<p>${decodeXml(previewPost.secure_media_embed.content)}</p>`);
        } else if (previewPost.gallery_data && previewPost.gallery_data.items && previewPost.gallery_data.items.length > 0 && previewPost.media_metadata) {
            previewPost.gallery_data.items.forEach(function(galleryItem) {
                var image = previewPost.media_metadata[galleryItem.media_id];
                if (!image) {
                    return;
                }

                var mediaHtml;
                if (image.e === 'AnimatedImage') {
                    var animation = image.s || {};
                    if (animation.mp4) {
                        var animationFallback = animation.gif ? makeImageHtml(animation.gif, animation) : `<a href="${animation.mp4}">Animation</a>`;
                        mediaHtml = `<video autoplay loop muted playsinline preload="metadata"><source src="${animation.mp4}" type="video/mp4"/>${animationFallback}</video>`;
                    } else if (animation.gif) {
                        mediaHtml = makeImageHtml(animation.gif, animation);
                    }
                } else if (image.e === 'Image') {
                    var suitable = image.p[image.p.length - 1];
                    if (suitable) {
                        mediaHtml = makeImageHtml(suitable.u, suitable);
                    }
                }

                if (!mediaHtml) {
                    return;
                }
                description.push(`<p>${mediaHtml}</p>`);
                if (galleryItem.caption) {
                    description.push(`<p>${encodeXml(String(galleryItem.caption))}</p>`);
                }
            });
        } else if (previewPost.preview && previewPost.preview.images && previewPost.preview.images.length > 0) {
            previewPost.preview.images.forEach(function (image) {
                var suitable = getSuitablePreviewImage(image);
                description.push(`<p>${makeImageHtml(suitable.url, suitable)}</p>`);
            });
        }

        var selftextHtml = post.selftext_html;
        if (selftextHtml === null && hasCrosspostParent) {
            selftextHtml = previewPost.selftext_html;
        }
        if (selftextHtml) {
            description.push(decodeXml(selftextHtml));
        }

        if (post.poll_data && Array.isArray(post.poll_data.options) && post.poll_data.options.length > 0) {
            var pollTitle = 'Poll';
            if (typeof post.poll_data.total_vote_count === 'number') {
                pollTitle += ' — ' + post.poll_data.total_vote_count + (post.poll_data.total_vote_count === 1 ? ' vote' : ' votes');
            }
            description.push(`<p><strong>${pollTitle}</strong></p>`);
            description.push('<ul>');
            post.poll_data.options.forEach(function(option) {
                if (option && option.text) {
                    description.push(`<li>${encodeXml(String(option.text))}</li>`);
                }
            });
            description.push('</ul>');
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

        var postTitle = post.subreddit + ' / ';
        postTitle += String(post.title || '').replace(/\.$/, '');
        postTitle += ' (' + post.num_comments + ' | ' + (post.score > 0 ? '+' : '') + post.score + ')';
        xml.push('      <title>' + encodeXml(postTitle) + '</title>');

        xml.push('      <link>' + encodeXml('https://reddit.com' + post.permalink) + '</link>');
        xml.push('      <author>' + encodeXml(post.author || '') + '</author>');
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
