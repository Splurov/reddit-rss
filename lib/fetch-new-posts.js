'use strict';

var fetchNewPosts = function(reddit, previousBefore, maxTime, reserveRequest, logDebug, onPage) {
    var newPosts = [];
    var deferredPosts = 0;
    var before = previousBefore;
    var seenCursors = {};

    if (before) {
        seenCursors[before] = true;
    }

    var getPage = function() {
        reserveRequest();
        logDebug('Get new posts {before: ' + (before || 'none') + '}');

        var params = {'limit': 100};
        if (before) {
            params.before = before;
        }

        return reddit.getNew(params).then(function(items) {
            var page = Array.prototype.slice.call(items).map(function(item) {
                return item.toJSON();
            });
            onPage(page.length);

            if (page.length === 0) {
                logDebug('Got new-post page {length: 0; finished}');
                return {
                    'posts': newPosts,
                    'deferredPosts': deferredPosts,
                    'before': before
                };
            }

            var maturePosts = page.filter(function(post) {
                return post.created_utc <= maxTime;
            });
            var deferredInPage = page.length - maturePosts.length;
            deferredPosts += deferredInPage;

            if (maturePosts.length === 0) {
                logDebug('Got new-post page {length: ' + page.length + '; deferred: ' + deferredInPage + '; waiting for ratings}');
                return {
                    'posts': newPosts,
                    'deferredPosts': deferredPosts,
                    'before': before
                };
            }

            maturePosts.forEach(function(post) {
                newPosts.push(post);
            });

            var nextBefore = maturePosts[0].name;
            if (!nextBefore || seenCursors[nextBefore]) {
                throw new Error('Can not continue new-post pagination');
            }
            logDebug('Got new-post page {length: ' + page.length + '; mature: ' + maturePosts.length + '; deferred: ' + deferredInPage + '; next before: ' + nextBefore + '}');
            seenCursors[nextBefore] = true;
            before = nextBefore;

            if (deferredInPage > 0) {
                return {
                    'posts': newPosts,
                    'deferredPosts': deferredPosts,
                    'before': before
                };
            }

            return getPage();
        });
    };

    return getPage();
};

module.exports = fetchNewPosts;
