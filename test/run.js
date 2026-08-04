'use strict';

var assert = require('assert');

var makeRss = require('../lib/make-rss');
var makeOpml = require('../lib/make-opml');
var fetchNewPosts = require('../lib/fetch-new-posts');
var RedditClient = require('../lib/reddit-client');
var subredditMinRules = require('../lib/min-rules');
var storageUtils = require('../lib/storage');
var nodemailer = require('nodemailer');

var posts = [{
    'name': 't3_example',
    'id': 'example',
    'subreddit': 'javascript',
    'author': 'example_author',
    'title': 'A post.',
    'permalink': '/r/javascript/comments/example/a_post/',
    'created_utc': 1460000000,
    'score': 12,
    'num_comments': 3,
    'is_self': true,
    'selftext_html': null
}];

var testRssAndOpml = function() {
    var emptyRss = makeRss('javascript', []);
    assert(emptyRss.indexOf('<title>reddit / r/javascript</title>') !== -1);
    assert(emptyRss.indexOf('<item>') === -1);
    assert(emptyRss.indexOf('<url>https://www.redditstatic.com/shreddit/assets/favicon/192x192.png</url>') !== -1);
    assert(emptyRss.indexOf('<rss version="2.0">\n  <channel>') !== -1);
    assert(emptyRss.endsWith('</rss>\n'));

    var rssWithCommunityIcon = makeRss('javascript', [], 'https://styles.redditmedia.com/icon.png?width=256&amp;s=example');
    assert(rssWithCommunityIcon.indexOf('<url>https://styles.redditmedia.com/icon.png?width=256&amp;s=example</url>') !== -1);

    var rss = makeRss('javascript', posts);
    assert(rss.indexOf('<item>') !== -1);
    assert(rss.indexOf('<author>example_author</author>') !== -1);
    assert(rss.indexOf('<author>javascript</author>') === -1);
    assert.strictEqual(posts[0].name, 't3_example');

    var opml = makeOpml([
        {'displayName': 'javascript', 'filename': 'r-javascript.xml'},
        {'displayName': 'node', 'filename': 'r-node.xml'}
    ], 'https://example.com/reddit-rss/rss/');
    assert(opml.indexOf('<opml version="2.0">') !== -1);
    assert(opml.indexOf('xmlUrl="https://example.com/reddit-rss/rss/r-javascript.xml"') !== -1);
    assert(opml.indexOf('htmlUrl="https://www.reddit.com/r/node/"') !== -1);
    assert(opml.indexOf('  <body>\n    <outline') !== -1);
    assert(opml.endsWith('</opml>\n'));
};

var testDependencyApis = function() {
    var escapedRss = makeRss('node&xml', []);
    assert(escapedRss.indexOf('<title>reddit / r/node&amp;xml</title>') !== -1);

    var rssWithHtml = makeRss('javascript', [{
        'name': 't3_entities',
        'id': 'entities',
        'subreddit': 'javascript',
        'title': 'Quotes: " and \'',
        'permalink': '/r/javascript/comments/entities/entities/',
        'created_utc': 1460000000,
        'score': 1,
        'num_comments': 1,
        'is_self': true,
        'selftext_html': '&lt;p&gt;Fish &amp; chips&lt;/p&gt;'
    }]);
    assert(rssWithHtml.indexOf('Quotes: &quot; and &apos;') !== -1);
    assert(rssWithHtml.indexOf('&lt;p&gt;Fish &amp; chips&lt;/p&gt;') !== -1);

    var rssWithEmbed = makeRss('wallets', [{
        'name': 't3_embed',
        'id': 'embed',
        'subreddit': 'wallets',
        'title': 'Embedded video',
        'permalink': '/r/wallets/comments/embed/embedded_video/',
        'created_utc': 1460000000,
        'score': 1,
        'num_comments': 1,
        'is_self': false,
        'url': 'https://example.com/video',
        'secure_media_embed': {
            'content': '&lt;iframe src="https://example.com/embed?autoplay=1&amp;amp;api=1"&gt;&lt;/iframe&gt;'
        }
    }]);
    assert(rssWithEmbed.indexOf('&lt;p&gt;&lt;iframe src=&quot;https://example.com/embed?autoplay=1&amp;amp;api=1&quot;&gt;&lt;/iframe&gt;&lt;/p&gt;') !== -1);
    assert(rssWithEmbed.indexOf('&amp;lt;iframe') === -1);

    var rssWithRedditVideo = makeRss('wallets', [{
        'name': 't3_reddit_video',
        'id': 'reddit_video',
        'subreddit': 'wallets',
        'title': 'Reddit video',
        'permalink': '/r/wallets/comments/reddit_video/reddit_video/',
        'created_utc': 1460000000,
        'score': 1,
        'num_comments': 1,
        'is_self': false,
        'is_reddit_media_domain': true,
        'url': 'https://v.redd.it/reddit-video',
        'media': {
            'reddit_video': {
                'fallback_url': 'https://v.redd.it/reddit-video/video.mp4'
            }
        },
        'preview': {
            'images': [{
                'source': {'url': 'https://preview.redd.it/reddit-video-source.jpg'},
                'resolutions': [{
                    'url': 'https://preview.redd.it/reddit-video-preview.jpg',
                    'width': 640,
                    'height': 360
                }]
            }]
        }
    }]);
    assert(rssWithRedditVideo.indexOf('&lt;video controls preload=&quot;metadata&quot; poster=&quot;https://preview.redd.it/reddit-video-preview.jpg&quot;&gt;') !== -1);
    assert(rssWithRedditVideo.indexOf('&lt;source src=&quot;https://v.redd.it/reddit-video/video.mp4&quot; type=&quot;video/mp4&quot;/&gt;') !== -1);
    assert(rssWithRedditVideo.indexOf('&lt;img src=&quot;https://preview.redd.it/reddit-video-preview.jpg&quot; width=&quot;640&quot; height=&quot;360&quot;/&gt;') !== -1);
    assert(rssWithRedditVideo.indexOf('&lt;p&gt;&lt;img src=&quot;https://preview.redd.it/reddit-video-preview.jpg&quot;') === -1);

    var rssWithCrosspostGallery = makeRss('CitiesSkylines2', [{
        'name': 't3_crosspost',
        'id': 'crosspost',
        'subreddit': 'CitiesSkylines2',
        'title': 'Crossposted gallery',
        'permalink': '/r/CitiesSkylines2/comments/crosspost/crossposted_gallery/',
        'created_utc': 1460000000,
        'score': 1,
        'num_comments': 1,
        'is_self': false,
        'url': 'https://www.reddit.com/gallery/original',
        'crosspost_parent_list': [{
            'gallery_data': {
                'items': [{
                    'media_id': 'gallery-image',
                    'caption': 'First & second <third>'
                }]
            },
            'media_metadata': {
                'gallery-image': {
                    'e': 'Image',
                    'p': [{
                        'u': 'https://preview.redd.it/crosspost-gallery.jpg',
                        'x': 1080,
                        'y': 720
                    }]
                }
            }
        }]
    }]);
    assert(rssWithCrosspostGallery.indexOf('https://preview.redd.it/crosspost-gallery.jpg') !== -1);
    assert(rssWithCrosspostGallery.indexOf('width=&quot;1080&quot; height=&quot;720&quot;') !== -1);
    assert(rssWithCrosspostGallery.indexOf('&lt;p&gt;First &amp;amp; second &amp;lt;third&amp;gt;&lt;/p&gt;') !== -1);

    var rssWithAnimatedGallery = makeRss('OpenAI', [{
        'name': 't3_animated_gallery',
        'id': 'animated_gallery',
        'subreddit': 'OpenAI',
        'title': 'Animated gallery',
        'permalink': '/r/OpenAI/comments/animated_gallery/animated_gallery/',
        'created_utc': 1460000000,
        'score': 1,
        'num_comments': 1,
        'is_self': false,
        'url': 'https://www.reddit.com/gallery/animated_gallery',
        'gallery_data': {
            'items': [{
                'media_id': 'animated-image',
                'caption': 'Animated caption'
            }]
        },
        'media_metadata': {
            'animated-image': {
                'e': 'AnimatedImage',
                's': {
                    'mp4': 'https://preview.redd.it/animated-image.mp4',
                    'gif': 'https://i.redd.it/animated-image.gif',
                    'x': 1280,
                    'y': 960
                }
            }
        }
    }]);
    assert(rssWithAnimatedGallery.indexOf('&lt;video autoplay loop muted playsinline preload=&quot;metadata&quot;&gt;') !== -1);
    assert(rssWithAnimatedGallery.indexOf('&lt;source src=&quot;https://preview.redd.it/animated-image.mp4&quot; type=&quot;video/mp4&quot;/&gt;') !== -1);
    assert(rssWithAnimatedGallery.indexOf('&lt;img src=&quot;https://i.redd.it/animated-image.gif&quot; width=&quot;1280&quot; height=&quot;960&quot;/&gt;') !== -1);
    assert(rssWithAnimatedGallery.indexOf('&lt;p&gt;Animated caption&lt;/p&gt;') !== -1);

    var originalPost = {
        'name': 't3_original',
        'id': 'original',
        'subreddit': 'originalsub',
        'title': 'Original post',
        'permalink': '/r/originalsub/comments/original/original_post/',
        'created_utc': 1460000000,
        'score': 12,
        'num_comments': 3,
        'is_self': false,
        'url': 'https://example.com/original'
    };
    var crosspost = {
        'name': 't3_crosspost_elsewhere',
        'id': 'crosspost_elsewhere',
        'subreddit': 'crosspostsub',
        'title': 'Crosspost of original',
        'permalink': '/r/crosspostsub/comments/crosspost_elsewhere/crosspost_of_original/',
        'created_utc': 1460000010,
        'score': 8,
        'num_comments': 5,
        'is_self': false,
        'url': 'https://reddit.com/r/originalsub/comments/original/original_post/',
        'crosspost_parent_list': [{
            'id': 'original',
            'subreddit': 'originalsub',
            'permalink': '/r/originalsub/comments/original/original_post/',
            'score': 12,
            'num_comments': 3
        }]
    };
    var postContext = {
        'originalsub': [originalPost],
        'crosspostsub': [crosspost]
    };
    var rssWithOriginalAndCrosspost = makeRss('originalsub', [originalPost], null, postContext);
    var rssWithOnlyCrosspost = makeRss('crosspostsub', [crosspost], null, postContext);
    assert.strictEqual((rssWithOriginalAndCrosspost.match(/<item>/g) || []).length, 1);
    assert(rssWithOriginalAndCrosspost.indexOf('https://reddit.com/r/originalsub/comments/original/original_post/') !== -1);
    assert(rssWithOriginalAndCrosspost.indexOf('https://reddit.com/r/crosspostsub/comments/crosspost_elsewhere/crosspost_of_original/') !== -1);
    assert(rssWithOriginalAndCrosspost.indexOf('5 — crosspostsub') !== -1);
    assert.strictEqual((rssWithOnlyCrosspost.match(/<item>/g) || []).length, 0);

    var sameLinkPost = {
        'name': 't3_same_link',
        'id': 'same_link',
        'subreddit': 'othersub',
        'title': 'Another post with the same link',
        'permalink': '/r/othersub/comments/same_link/another_post_with_the_same_link/',
        'created_utc': 1460000020,
        'score': 15,
        'num_comments': 2,
        'is_self': false,
        'url': 'https://example.com/original'
    };
    var postContextWithSameLink = {
        'originalsub': [originalPost],
        'othersub': [sameLinkPost],
        'crosspostsub': [crosspost]
    };
    var rssWithSameLinkAndCrosspost = makeRss('originalsub', [originalPost], null, postContextWithSameLink);
    var rssWithSameLinkInOtherSubreddit = makeRss('othersub', [sameLinkPost], null, postContextWithSameLink);
    assert.strictEqual((rssWithSameLinkAndCrosspost.match(/<item>/g) || []).length, 1);
    assert(rssWithSameLinkAndCrosspost.indexOf('https://reddit.com/r/originalsub/comments/original/original_post/') !== -1);
    assert(rssWithSameLinkAndCrosspost.indexOf('https://reddit.com/r/othersub/comments/same_link/another_post_with_the_same_link/') !== -1);
    assert(rssWithSameLinkAndCrosspost.indexOf('https://reddit.com/r/crosspostsub/comments/crosspost_elsewhere/crosspost_of_original/') !== -1);
    assert.strictEqual((rssWithSameLinkInOtherSubreddit.match(/<item>/g) || []).length, 0);

    var unmatchedCrosspost = {
        'name': 't3_unmatched_crosspost',
        'id': 'unmatched_crosspost',
        'subreddit': 'manybaggers',
        'title': 'Crosspost without downloaded parent',
        'permalink': '/r/manybaggers/comments/unmatched_crosspost/crosspost_without_downloaded_parent/',
        'created_utc': 1460000030,
        'score': 4,
        'num_comments': 1,
        'is_self': false,
        'url': '/r/BagBoysClub/comments/missing_parent/source_post/',
        'crosspost_parent_list': [{
            'id': 'missing_parent',
            'subreddit': 'BagBoysClub',
            'permalink': '/r/BagBoysClub/comments/missing_parent/source_post/',
            'score': 4,
            'num_comments': 2
        }]
    };
    var sameUrlUnmatchedCrosspost = {
        'name': 't3_same_url_unmatched_crosspost',
        'id': 'same_url_unmatched_crosspost',
        'subreddit': 'backpacks',
        'title': 'Another crosspost without downloaded parent',
        'permalink': '/r/backpacks/comments/same_url_unmatched_crosspost/another_crosspost_without_downloaded_parent/',
        'created_utc': 1460000040,
        'score': 7,
        'num_comments': 2,
        'is_self': false,
        'url': '/r/BagBoysClub/comments/missing_parent/source_post/',
        'crosspost_parent_list': [{
            'id': 'missing_parent',
            'subreddit': 'BagBoysClub',
            'permalink': '/r/BagBoysClub/comments/missing_parent/source_post/',
            'score': 4,
            'num_comments': 2
        }]
    };
    var unmatchedCrosspostContext = {
        'manybaggers': [unmatchedCrosspost],
        'backpacks': [sameUrlUnmatchedCrosspost]
    };
    var rssWithUnmatchedCrosspost = makeRss('manybaggers', [unmatchedCrosspost], null, unmatchedCrosspostContext);
    var rssWithSameUrlUnmatchedCrosspost = makeRss('backpacks', [sameUrlUnmatchedCrosspost], null, unmatchedCrosspostContext);
    assert.strictEqual((rssWithUnmatchedCrosspost.match(/<item>/g) || []).length, 1);
    assert.strictEqual((rssWithSameUrlUnmatchedCrosspost.match(/<item>/g) || []).length, 1);
    assert(rssWithUnmatchedCrosspost.indexOf('https://reddit.com/r/backpacks/comments/same_url_unmatched_crosspost/another_crosspost_without_downloaded_parent/') === -1);
    assert(rssWithSameUrlUnmatchedCrosspost.indexOf('https://reddit.com/r/manybaggers/comments/unmatched_crosspost/crosspost_without_downloaded_parent/') === -1);
    assert(rssWithUnmatchedCrosspost.indexOf('https://reddit.com/r/BagBoysClub/comments/missing_parent/source_post/') !== -1);
    assert(rssWithUnmatchedCrosspost.indexOf('2 — BagBoysClub') !== -1);
    assert(rssWithUnmatchedCrosspost.indexOf('crosspost from') === -1);

    var transporter = nodemailer.createTransport('smtp://localhost:2525');
    assert.strictEqual(typeof transporter.sendMail, 'function');
};

var testSubredditMinRules = function() {
    var rulesBySubreddit = subredditMinRules.normalize({
        'r/JavaScript': {'minScore': 20, 'minComments': 5}
    });
    var defaultRules = {'minScore': 7, 'minComments': 12};

    assert.deepStrictEqual(rulesBySubreddit, {
        'javascript': {'minScore': 20, 'minComments': 5}
    });
    assert.strictEqual(subredditMinRules.getForSubreddit(rulesBySubreddit, 'javascript', defaultRules), rulesBySubreddit.javascript);
    assert.strictEqual(subredditMinRules.getForSubreddit(rulesBySubreddit, 'node', defaultRules), defaultRules);
    assert.throws(function() {
        subredditMinRules.normalize({'javascript': {'minScore': 20}});
    }, /minComments is required/);
    assert.throws(function() {
        subredditMinRules.normalize({'javascript': {'minScore': -1, 'minComments': 5}});
    }, /minScore must be a non-negative number/);
};

var testStorageFallbackBefores = function() {
    var fallbackBefores = storageUtils.getFallbackBefores({
        'first': [
            {'name': 't3_z'},
            {'name': 't3_10'},
            {'name': 't3_12'},
            {'name': 'invalid'}
        ],
        'second': [
            {'name': 't3_y'},
            {'name': 't3_Z'},
            {'id': 'x'}
        ]
    }, 't3_11');

    assert.deepStrictEqual(fallbackBefores, ['t3_10', 't3_z', 't3_y']);
    assert.deepStrictEqual(storageUtils.getFallbackBefores({}, 't3_11'), []);
    assert.deepStrictEqual(storageUtils.getFallbackBefores({'first': [{'name': 't3_z'}]}, 'invalid'), []);
};

var makePost = function(number) {
    return {
        'name': 't3_new_' + number,
        'created_utc': number
    };
};

var testNewPostPagination = function() {
    var firstPage = [];
    var requests = [];
    var pageLengths = [];
    var reservedRequests = 0;
    for (var number = 100; number >= 1; number--) {
        firstPage.push(makePost(number));
    }

    var reddit = {
        'getNew': function(params) {
            requests.push(params);
            if (requests.length === 1) {
                return Promise.resolve(firstPage);
            }
            if (requests.length === 2) {
                return Promise.resolve([makePost(101)]);
            }
            return Promise.resolve([]);
        }
    };

    return fetchNewPosts(reddit, 't3_saved_before', 1000, function() {
        reservedRequests++;
    }, function() {}, function(pageLength) {
        pageLengths.push(pageLength);
    }).then(function(result) {
        assert.strictEqual(reservedRequests, 3);
        assert.deepStrictEqual(requests[0], {'limit': 100, 'before': 't3_saved_before'});
        assert.deepStrictEqual(requests[1], {'limit': 100, 'before': 't3_new_100'});
        assert.deepStrictEqual(requests[2], {'limit': 100, 'before': 't3_new_101'});
        assert.deepStrictEqual(pageLengths, [100, 1, 0]);
        assert.strictEqual(result.posts.length, 101);
        assert.strictEqual(result.before, 't3_new_101');
        assert.strictEqual(result.posts[result.posts.length - 1].name, 't3_new_101');
        assert.strictEqual(result.requestLimitReached, false);
    });
};

var testNewPostRequestLimitPreservesProgress = function() {
    var requests = [];
    var firstPage = [];
    var secondPage = [];
    for (var number = 100; number >= 1; number--) {
        firstPage.push(makePost(number));
    }
    for (var secondNumber = 200; secondNumber >= 101; secondNumber--) {
        secondPage.push(makePost(secondNumber));
    }

    var reddit = {
        'getNew': function(params) {
            requests.push(params);
            if (params.before === 't3_saved_before') {
                return Promise.resolve(firstPage);
            }
            if (params.before === 't3_new_100') {
                return Promise.resolve(secondPage);
            }
            if (params.before === 't3_new_200') {
                return Promise.resolve([makePost(201)]);
            }
            return Promise.resolve([]);
        }
    };
    var remainingRequests = 2;
    var reserveLimitedRequest = function() {
        if (remainingRequests === 0) {
            return false;
        }
        remainingRequests--;
        return true;
    };

    return fetchNewPosts(reddit, 't3_saved_before', 1000, reserveLimitedRequest, function() {}, function() {}).then(function(firstResult) {
        assert.strictEqual(firstResult.posts.length, 200);
        assert.strictEqual(firstResult.before, 't3_new_200');
        assert.strictEqual(firstResult.requestLimitReached, true);
        assert.deepStrictEqual(requests, [
            {'limit': 100, 'before': 't3_saved_before'},
            {'limit': 100, 'before': 't3_new_100'}
        ]);

        return fetchNewPosts(reddit, firstResult.before, 1000, function() {
            return true;
        }, function() {}, function() {});
    }).then(function(secondResult) {
        assert.strictEqual(secondResult.posts.length, 1);
        assert.strictEqual(secondResult.posts[0].name, 't3_new_201');
        assert.strictEqual(secondResult.before, 't3_new_201');
        assert.strictEqual(secondResult.requestLimitReached, false);
        assert.deepStrictEqual(requests.slice(2), [
            {'limit': 100, 'before': 't3_new_200'},
            {'limit': 100, 'before': 't3_new_201'}
        ]);
    });
};

var testRecentPostsAreDeferred = function() {
    var requests = [];
    var reddit = {
        'getNew': function(params) {
            requests.push(params);
            return Promise.resolve([
                makePost(102),
                makePost(100),
                makePost(99)
            ]);
        }
    };

    return fetchNewPosts(reddit, 't3_saved_before', 100, function() {}, function() {}, function() {}).then(function(result) {
        assert.deepStrictEqual(requests, [{'limit': 100, 'before': 't3_saved_before'}]);
        assert.strictEqual(result.posts.length, 2);
        assert.strictEqual(result.posts[0].name, 't3_new_100');
        assert.strictEqual(result.before, 't3_new_100');
        assert.strictEqual(result.deferredPosts, 1);
    });
};

var testDeletedBeforeUsesStorageFallback = function() {
    var requests = [];
    var debugMessages = [];
    var reddit = {
        'getNew': function(params) {
            requests.push(params);
            if (params.before === 't3_b' || params.before === 't3_a') {
                return Promise.resolve([]);
            }
            if (params.before === 't3_9') {
                return Promise.resolve([{'name': 't3_c', 'created_utc': 100}]);
            }
            if (params.before === 't3_c') {
                return Promise.resolve([]);
            }
            throw new Error('Unexpected before: ' + params.before);
        }
    };

    return fetchNewPosts(reddit, 't3_b', 1000, function() {
        return true;
    }, function(message) {
        debugMessages.push(message);
    }, function() {}, ['t3_a', 't3_9']).then(function(result) {
        assert.deepStrictEqual(requests, [
            {'limit': 100, 'before': 't3_b'},
            {'limit': 100, 'before': 't3_a'},
            {'limit': 100, 'before': 't3_9'},
            {'limit': 100, 'before': 't3_c'}
        ]);
        assert.strictEqual(result.posts.length, 1);
        assert.strictEqual(result.posts[0].name, 't3_c');
        assert.strictEqual(result.before, 't3_c');
        assert.strictEqual(result.requestLimitReached, false);
        assert(debugMessages.some(function(message) {
            return message.indexOf('Recovered new-post pagination') !== -1;
        }));
    });
};

var testStorageFallbackDoesNotRegressValidBefore = function() {
    var requests = [];
    var reddit = {
        'getNew': function(params) {
            requests.push(params);
            if (params.before === 't3_b') {
                return Promise.resolve([]);
            }
            if (params.before === 't3_a') {
                return Promise.resolve([{'name': 't3_b', 'created_utc': 100}]);
            }
            throw new Error('Unexpected before: ' + params.before);
        }
    };

    return fetchNewPosts(reddit, 't3_b', 1000, function() {
        return true;
    }, function() {}, function() {}, ['t3_a']).then(function(result) {
        assert.deepStrictEqual(requests, [
            {'limit': 100, 'before': 't3_b'},
            {'limit': 100, 'before': 't3_a'}
        ]);
        assert.strictEqual(result.before, 't3_b');
        assert.strictEqual(result.requestLimitReached, false);
    });
};

var testRedditClient = function() {
    var requests = [];
    var debugMessages = [];
    var client = new RedditClient({
        'userAgent': 'reddit-rss-test',
        'clientId': 'client-id',
        'clientSecret': 'client-secret',
        'username': 'username',
        'password': 'password',
        'logDebug': function(message) {
            debugMessages.push(message);
        }
    });

    client._request = function(options) {
        requests.push(options);
        if (requests.length === 1) {
            return Promise.resolve({
                'statusCode': 200,
                'body': JSON.stringify({'access_token': 'token-1', 'expires_in': 3600})
            });
        }
        if (requests.length === 2) {
            return Promise.resolve({
                'statusCode': 200,
                'body': JSON.stringify({
                    'data': {
                        'children': [{
                            'data': {
                                'name': 't5_javascript',
                                'display_name': 'javascript',
                                'subscribers': 10,
                                'community_icon': 'https://styles.redditmedia.com/icon.png'
                            }
                        }]
                    }
                })
            });
        }
        return Promise.resolve({
            'statusCode': 200,
            'body': JSON.stringify({
                'data': {
                    'children': [{
                        'data': makePost(1)
                    }]
                }
            })
        });
    };

    return client.getSubscriptions({'limit': 100, 'after': 't5_previous'}).then(function(subscriptions) {
        assert.strictEqual(subscriptions[0].display_name, 'javascript');
        assert.strictEqual(subscriptions[0].community_icon, 'https://styles.redditmedia.com/icon.png');
        assert.strictEqual(requests[0].hostname, 'www.reddit.com');
        assert.strictEqual(requests[0].path, '/api/v1/access_token');
        assert.strictEqual(requests[0].headers.Authorization, 'Basic Y2xpZW50LWlkOmNsaWVudC1zZWNyZXQ=');
        assert.strictEqual(requests[0].body, 'grant_type=password&username=username&password=password');
        assert.strictEqual(requests[1].hostname, 'oauth.reddit.com');
        assert.strictEqual(requests[1].path, '/subreddits/mine/subscriber?limit=100&after=t5_previous');
        assert.strictEqual(requests[1].headers.Authorization, 'Bearer token-1');
        assert.deepStrictEqual(debugMessages, [
            'Request URL {url: https://www.reddit.com/api/v1/access_token}',
            'Request URL {url: https://oauth.reddit.com/subreddits/mine/subscriber?limit=100&after=t5_previous}'
        ]);

        return client.getNew({'limit': 100, 'before': 't3_before'});
    }).then(function(posts) {
        assert.strictEqual(posts[0].name, 't3_new_1');
        assert.strictEqual(requests.length, 3);
        assert.strictEqual(requests[2].path, '/new?limit=100&before=t3_before');
        assert.strictEqual(debugMessages[2], 'Request URL {url: https://oauth.reddit.com/new?limit=100&before=t3_before}');
    });
};

var testRedditClientRefreshesUnauthorizedToken = function() {
    var requests = [];
    var client = new RedditClient({
        'userAgent': 'reddit-rss-test',
        'clientId': 'client-id',
        'clientSecret': 'client-secret',
        'username': 'username',
        'password': 'password'
    });

    client._request = function(options) {
        requests.push(options);
        if (requests.length === 1) {
            return Promise.resolve({
                'statusCode': 200,
                'body': JSON.stringify({'access_token': 'expired-token', 'expires_in': 3600})
            });
        }
        if (requests.length === 2) {
            return Promise.resolve({
                'statusCode': 401,
                'body': JSON.stringify({'message': 'Unauthorized'})
            });
        }
        if (requests.length === 3) {
            return Promise.resolve({
                'statusCode': 200,
                'body': JSON.stringify({'access_token': 'fresh-token', 'expires_in': 3600})
            });
        }
        return Promise.resolve({
            'statusCode': 200,
            'body': JSON.stringify({'data': {'children': []}})
        });
    };

    return client.getNew({'limit': 100}).then(function(posts) {
        assert.deepStrictEqual(posts, []);
        assert.strictEqual(requests.length, 4);
        assert.strictEqual(requests[1].headers.Authorization, 'Bearer expired-token');
        assert.strictEqual(requests[3].headers.Authorization, 'Bearer fresh-token');
    });
};

testRssAndOpml();
testDependencyApis();
testSubredditMinRules();
testStorageFallbackBefores();
Promise.all([
    testNewPostPagination(),
    testNewPostRequestLimitPreservesProgress(),
    testRecentPostsAreDeferred(),
    testDeletedBeforeUsesStorageFallback(),
    testStorageFallbackDoesNotRegressValidBefore(),
    testRedditClient(),
    testRedditClientRefreshesUnauthorizedToken()
]).then(function() {
    console.log('All tests passed');
}).catch(function(error) {
    console.error(error);
    process.exitCode = 1;
});
