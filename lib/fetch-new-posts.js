'use strict';

var fetchNewPosts = function(reddit, previousBefore, maxTime, reserveRequest, logDebug, onPage, fallbackBefores) {
    var newPosts = [];
    var deferredPosts = 0;
    var before = previousBefore;
    var seenCursors = {};
    var fallbackQueue = Array.isArray(fallbackBefores) ? fallbackBefores.slice() : [];
    var canTryFallback = Boolean(previousBefore);

    if (before) {
        seenCursors[before] = true;
    }

    var makeResult = function(requestLimitReached) {
        return {
            'posts': newPosts,
            'deferredPosts': deferredPosts,
            'before': before,
            'requestLimitReached': requestLimitReached
        };
    };

    var getPage = function(requestBefore) {
        if (reserveRequest() === false) {
            logDebug('Can not get more new posts {request limit reached; before: ' + (before || 'none') + '}');
            return Promise.resolve(makeResult(true));
        }
        logDebug('Get new posts {before: ' + (requestBefore || 'none') + '}');

        var params = {'limit': 100};
        if (requestBefore) {
            params.before = requestBefore;
        }

        return reddit.getNew(params).then(function(items) {
            var page = Array.prototype.slice.call(items);
            onPage(page.length);

            if (page.length === 0) {
                if (canTryFallback && fallbackQueue.length > 0) {
                    var fallbackBefore = fallbackQueue.shift();
                    logDebug('Got empty new-post page {before: ' + requestBefore + '; trying storage fallback: ' + fallbackBefore + '}');
                    return getPage(fallbackBefore);
                }
                logDebug('Got new-post page {length: 0; finished}');
                return makeResult(false);
            }

            canTryFallback = false;
            if (requestBefore !== before) {
                logDebug('Recovered new-post pagination {old before: ' + before + '; storage fallback: ' + requestBefore + '}');
                before = requestBefore;
            }

            var maturePosts = page.filter(function(post) {
                return post.created_utc <= maxTime;
            });
            var deferredInPage = page.length - maturePosts.length;
            deferredPosts += deferredInPage;

            if (maturePosts.length === 0) {
                logDebug('Got new-post page {length: ' + page.length + '; deferred: ' + deferredInPage + '; waiting for ratings}');
                return makeResult(false);
            }

            maturePosts.forEach(function(post) {
                newPosts.push(post);
            });

            var nextBefore = maturePosts[0].name;
            if (!nextBefore) {
                throw new Error('Can not continue new-post pagination');
            }
            if (seenCursors[nextBefore]) {
                if (requestBefore !== previousBefore && nextBefore === previousBefore) {
                    before = previousBefore;
                    logDebug('Storage fallback reached saved before {before: ' + before + '; no new mature posts}');
                    return makeResult(false);
                }
                throw new Error('Can not continue new-post pagination');
            }
            logDebug('Got new-post page {length: ' + page.length + '; mature: ' + maturePosts.length + '; deferred: ' + deferredInPage + '; next before: ' + nextBefore + '}');
            seenCursors[nextBefore] = true;
            before = nextBefore;

            if (deferredInPage > 0) {
                return makeResult(false);
            }

            return getPage(before);
        });
    };

    return getPage(before);
};

module.exports = fetchNewPosts;
