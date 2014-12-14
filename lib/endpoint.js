var Endpoint, Q, dot, hooks, httperror, log, minimatch, moment, mongoose, request, tracker, _;

mongoose = require('mongoose');

Q = require('q');

httperror = require('./httperror');

_ = require('underscore');

dot = require('dot-component');

request = require('./request');

log = require('./log');

moment = require('moment');

tracker = require('./tracker');

hooks = require('hooks');

minimatch = require('minimatch');

/*
Middle ware is separate
*/


module.exports = Endpoint = (function() {
  /*
  	 * @param String path 			the base URL for the endpoint
  	 * @param String modelId 		the name of the document
  	 * @param Object opts 			Additional options (see defaults below)
  */

  function Endpoint(path, modelId, opts) {
    this.path = path;
    this.modelId = modelId;
    if (typeof modelId === 'string') {
      this.$modelClass = mongoose.model(modelId);
    } else {
      this.$modelClass = modelId;
    }
    log("Creating endpoint at path: " + path);
    this.$taps = {};
    this.options = {
      queryParams: [],
      pagination: {
        perPage: 50,
        sortField: '_id'
      },
      populate: []
    };
    if (opts != null) {
      this.options = _.extend(this.options, opts);
    }
    this.$$middleware = {
      fetch: [this.$$trackingMiddleware(this)],
      list: [this.$$trackingMiddleware(this)],
      post: [this.$$trackingMiddleware(this)],
      put: [this.$$trackingMiddleware(this)],
      bulkpost: [this.$$trackingMiddleware(this)],
      "delete": [this.$$trackingMiddleware(this)]
    };
    this.tap('pre_filter', 'list', this.$$constructFilterFromRequest);
  }

  /*
  	 * Add field to populate options. These fields will be populated on every request except delete
  	 *
  	 * @param String field
  	 * @return Endpoint for chaining
  */


  Endpoint.prototype.populate = function(field, fields) {
    var p, _i, _len;
    if (fields == null) {
      fields = null;
    }
    if (field instanceof Array) {
      for (_i = 0, _len = field.length; _i < _len; _i++) {
        p = field[_i];
        this.options.populate.push(p);
      }
    } else if (fields) {
      this.options.populate.push([field, fields]);
    } else {
      this.options.populate.push(field);
    }
    return this;
  };

  /*
  	 * Allow a query param or params to become part of the search filter for list requests.
  	 *
  	 * @param String|Array param
  	 * @return Endpoint for chaining
  */


  Endpoint.prototype.allowQueryParam = function(param) {
    var p, _i, _len;
    if (param instanceof Array) {
      for (_i = 0, _len = param.length; _i < _len; _i++) {
        p = param[_i];
        this.options.queryParams.push(p);
      }
    } else {
      this.options.queryParams.push(param);
    }
    return this;
  };

  /*
  	 * Fetch only specific fields in a list request
  	 *
  	 * @param Array of fields
  */


  Endpoint.prototype.limitFields = function(fields) {
    this.options.limitFields = fields;
    return this;
  };

  /*
  	 * Set cascade parameters for playing nicely with cascading-relations package
  	 *
  	 * @param Array allowed 		Allowed relation paths
  	 * @param Function filter 		Filter function to pass all related docs through
  	 * @return Endpoint for chaining
  */


  Endpoint.prototype.cascade = function(allowed, filter) {
    this.options.cascade = {
      allowedRelations: allowed,
      filter: filter
    };
    return this;
  };

  /*
  	 * Tap a function onto a hook. Hooks may pass a value through each function to get the final
  	 * result (filter) or just execute all the functions in a row (action).
  	 * Each function is structured the same; they just may have a null value for the
  	 * `data` argument (2nd argument).
  	 *
  	 * Functions look like this:
  	 * `function(arguments, data, next) {}`
  	 *
  	 * ...and must either call next(data) (optionally with modified data) or just return a
  	 * non-null value (the system assumes that a null return value means that next will be
  	 * called instead)
  	 *
  	 * HOOKS:
  	 * * pre_filter (before execution [default values, remove fields, etc]). Note that the "fetch"
  	 * 		filter will be used for retrieving documents in PUT and DELETE requests before performing
  	 * 		operations on them. Useful for limiting the documents people have access to.
  	 * * post_retrieve (after retrieval of the model [maybe they can only do something
  	 * 		if the model has a certain value]). Only applies on PUT/DELETE requests
  	 * * pre_response (after execution, before response [hide fields, modify, etc])
  	 * * pre_response_error (after execution, before response, if execution throws an error)
  	 *
  	 * @param String hook 		The name of the hook
  	 * @param String method 	The method (fetch, list, post, put, delete).
  	 * @param Function func 	Function to run on hook
  */


  Endpoint.prototype.tap = function(hook, method, func) {
    var methods, untap, _i, _len,
      _this = this;
    log('Tapping onto: ', hook.green + '::' + method.green);
    if (method === '*') {
      methods = ['fetch', 'list', 'create', 'update', 'delete'];
    } else {
      methods = [method];
    }
    if (!this.$taps[hook]) {
      this.$taps[hook] = {};
    }
    for (_i = 0, _len = methods.length; _i < _len; _i++) {
      method = methods[_i];
      if (!this.$taps[hook][method]) {
        this.$taps[hook][method] = [];
      }
      this.$taps[hook][method].push(func);
    }
    untap = function() {
      var index;
      index = _this.$taps[hook][method].indexOf(func);
      return _this.$taps[hook][method].splice(index, 1);
    };
    return this;
  };

  /*
  	 * Add standard express middleware to one of the five methods. "all" or "*"
  	 * apply for all five. Connect middleware syntax applies.
  	 *
  	 * @param String method 			Method name
  	 * @param Function middleware 		Connect-style middleware function
  	 * @return Endpoint for chaining
  */


  Endpoint.prototype.addMiddleware = function(method, middleware) {
    var m, _i, _j, _len, _len1, _ref;
    if (method === 'all' || method === '*') {
      _ref = ['list', 'fetch', 'post', 'put', 'delete'];
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        m = _ref[_i];
        this.addMiddleware(m, middleware);
      }
      if (this.options.allowBulkPost) {
        this.addMiddleware('bulkpost', middleware);
      }
    } else {
      if (middleware instanceof Array) {
        for (_j = 0, _len1 = middleware.length; _j < _len1; _j++) {
          m = middleware[_j];
          this.addMiddleware(method, m);
        }
      } else {
        this.$$middleware[method].push(middleware);
      }
    }
    return this;
  };

  /*
  	 * Enable bulk post for this endpoint.
  */


  Endpoint.prototype.allowBulkPost = function() {
    this.options.allowBulkPost = true;
    return this;
  };

  /*
  	 * Expose the verb handlers as methods so they can be used in HMVC
  	 *
  */


  Endpoint.prototype.$fetch = function(req, res) {
    return new request(this).$fetch(req, res);
  };

  Endpoint.prototype.$list = function(req, res) {
    return new request(this).$list(req, res);
  };

  Endpoint.prototype.$post = function(req, res) {
    return new request(this).$post(req, res);
  };

  Endpoint.prototype.$put = function(req, res) {
    return new request(this).$put(req, res);
  };

  Endpoint.prototype.$delete = function(req, res) {
    return new request(this).$delete(req, res);
  };

  Endpoint.prototype.$$trackingMiddleware = function(endpoint) {
    return function(req, res, next) {
      var k, path, startTime, v;
      for (k in hooks) {
        v = hooks[k];
        res[k] = hooks[k];
      }
      path = endpoint.path;
      if (req.header('X-Request-Start')) {
        startTime = moment(parseInt(req.header('X-Request-Start')));
      } else {
        startTime = moment();
      }
      res.$mre = {
        startTime: startTime,
        method: null
      };
      res.post('end', function(next, data) {
        var code, elapsed;
        code = this.statusCode;
        elapsed = moment().diff(this.$mre.startTime);
        tracker.track({
          request: req,
          time: elapsed,
          endpoint: path,
          url: req.originalUrl,
          method: this.$mre.method,
          response: {
            code: code,
            success: code >= 200 && code < 400 ? true : false,
            error: code >= 400 && (data != null) ? data : null
          }
        });
        return next();
      });
      return next();
    };
  };

  /*
  	 * Register the endpoints on an express app.
  	 *
  	 * @param Express app
  */


  Endpoint.prototype.register = function(app) {
    var _this = this;
    log('Registered endpoints for path:', this.path.green);
    app.get(this.path + '/:id', this.$$middleware.fetch, function(req, res) {
      res.$mre.method = 'fetch';
      log(_this.path.green, 'request to ', 'FETCH'.bold);
      return new request(_this).$fetch(req, res).then(function(response) {
        log('About to send.');
        return res.status(200).send(response);
      }, function(err) {
        if (err.code) {
          return res.status(err.code).send(err.message);
        } else {
          return res.status(500).send();
        }
      });
    });
    app.get(this.path, this.$$middleware.list, function(req, res) {
      res.$mre.method = 'list';
      log(_this.path.green, 'request to ', 'LIST'.bold);
      return new request(_this).$list(req, res).then(function(response) {
        return res.status(200).send(response);
      }, function(err) {
        if (err.code) {
          return res.status(err.code).send(err.message);
        } else {
          return res.status(500).send();
        }
      });
    });
    app.post(this.path, this.$$middleware.post, function(req, res) {
      res.$mre.method = 'post';
      log(_this.path.green, 'request to ', 'POST'.bold);
      return new request(_this).$post(req, res).then(function(response) {
        return res.status(201).send(response);
      }, function(err) {
        if (err.code) {
          return res.status(err.code).send(err.message);
        } else {
          return res.status(500).send();
        }
      });
    });
    if (this.options.allowBulkPost) {
      app.post(this.path + '/bulk', this.$$middleware.bulkpost, function(req, res) {
        res.$mre.method = 'bulkpost';
        log(_this.path.green, 'request to ', 'BULKPOST'.bold);
        return new request(_this).$bulkpost(req, res).then(function(response) {
          return res.status(201).send(response);
        }, function(err) {
          if (err.code) {
            return res.status(err.code).send(err);
          } else {
            return res.status(500).send();
          }
        });
      });
    }
    app.put(this.path + '/:id', this.$$middleware.put, function(req, res) {
      res.$mre.method = 'put';
      log(_this.path.green, 'request to ', 'PUT'.bold);
      return new request(_this).$put(req, res).then(function(response) {
        return res.status(200).send(response);
      }, function(err) {
        if (err.code) {
          return res.status(err.code).send(err.message);
        } else {
          return res.status(500).send();
        }
      });
    });
    return app["delete"](this.path + '/:id', this.$$middleware["delete"], function(req, res) {
      res.$mre.method = 'delete';
      log(_this.path.green, 'request to ', 'DELETE'.bold);
      return new request(_this).$delete(req, res).then(function() {
        return res.status(200).send();
      }, function(err) {
        if (err.code) {
          return res.status(err.code).send(err.message);
        } else {
          return res.status(500).send();
        }
      });
    });
  };

  Endpoint.prototype.$$constructFilterFromRequest = function(req, data, next) {
    var addToFilter, filter, k, q, v, _i, _len, _ref, _ref1;
    addToFilter = function(filter, prop, key, val) {
      if (key === '$in' && !(val instanceof Array)) {
        val = [val];
      }
      if (filter[prop] != null) {
        return filter[prop][key] = val;
      } else {
        filter[prop] = {};
        return filter[prop][key] = val;
      }
    };
    filter = {};
    if (this.$$endpoint.options.queryParams) {
      _ref = req.query;
      for (k in _ref) {
        v = _ref[k];
        if (v && (_.isString(v) || v instanceof Date)) {
          _ref1 = this.$$endpoint.options.queryParams;
          for (_i = 0, _len = _ref1.length; _i < _len; _i++) {
            q = _ref1[_i];
            if (minimatch(k, q)) {
              if (v === '$exists') {
                v = {
                  $exists: true
                };
              }
              if (k.substr(0, 4) === '$lt_') {
                addToFilter(filter, k.replace('$lt_', ''), '$lt', v);
              } else if (k.substr(0, 5) === '$lte_') {
                addToFilter(filter, k.replace('$lte_', ''), '$lte', v);
              } else if (k.substr(0, 4) === '$gt_') {
                addToFilter(filter, k.replace('$gt_', ''), '$gt', v);
              } else if (k.substr(0, 5) === '$gte_') {
                addToFilter(filter, k.replace('$gte_', ''), '$gte', v);
              } else if (k.substr(0, 4) === '$in_') {
                addToFilter(filter, k.replace('$in_', ''), '$in', v);
              } else if (k.substr(0, 4) === '$ne_') {
                addToFilter(filter, k.replace('$ne_', ''), '$ne', v);
              } else if (k.substr(0, 7) === '$regex_') {
                addToFilter(filter, k.replace('$regex_', ''), '$regex', new RegExp(v));
              } else if (k.substr(0, 8) === '$regexi_') {
                addToFilter(filter, k.replace('$regexi_', ''), '$regex', new RegExp(v, 'i'));
              } else {
                filter[k] = v;
              }
            }
          }
        }
      }
    }
    return next(filter);
  };

  return Endpoint;

})();
