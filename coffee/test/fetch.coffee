express = require 'express'
request = require 'supertest'
should = require 'should'
Q = require 'q'

mongoose = require 'mongoose'

moment = require 'moment'

require('../lib/log')#.verbose(true)
tracker = require '../lib/tracker'
mre = require '../lib/endpoint'
# Custom "Post" and "Comment" documents

commentSchema = new mongoose.Schema
	comment:String
	otherField:Number
	_post:
		type:mongoose.Schema.Types.ObjectId
		ref:'Post'
	_author:
		type:mongoose.Schema.Types.ObjectId
		ref:'Author'


postSchema = new mongoose.Schema
	date:Date
	number:Number
	string:
		type:String
		required:true
	_comments:[
			type:mongoose.Schema.Types.ObjectId
			ref:'Comment'
			$through:'_post'
	]
	otherField:mongoose.Schema.Types.Mixed

authorSchema = new mongoose.Schema
	name:'String'

# Custom middleware for testing
requirePassword = (password) ->
	return (req, res, next) ->
		if req.query.password and req.query.password is password
			next()
		else
			res.send(401)
mongoose.connect('mongodb://localhost/mre_test')

cascade = require 'cascading-relations'


postSchema.plugin(cascade)
commentSchema.plugin(cascade)
authorSchema.plugin(cascade)

mongoose.model('Post', postSchema)
mongoose.model('Comment', commentSchema)
mongoose.model('Author', authorSchema)

mongoose.set 'debug', true



describe 'Fetch', ->

	describe 'Basic object', ->
		beforeEach (done) ->
			@endpoint = new mre('/api/posts', 'Post')
			@app = express()
			@app.use(express.bodyParser())
			@app.use(express.methodOverride())

			modClass = mongoose.model('Post')
			mod = modClass
				date:Date.now()
				number:5
				string:'Test'
			mod.save (err, res) =>
				@mod = res
				done()
		afterEach (done) ->
			@mod.remove ->
				done()
		it 'should retrieve with no hooks', (done) ->


			@endpoint.register(@app)


			request(@app).get('/api/posts/' + @mod._id).end (err, res) ->
				console.log res.text
				res.status.should.equal(200)
				res.body.number.should.equal(5)
				res.body.string.should.equal('Test')
				done()

		it 'should honor bad pre_filter hook', (done) ->
			@endpoint.tap 'pre_filter', 'fetch', (args, data, next) ->
				data.number = 6
				next(data)
			.register(@app)

			request(@app).get('/api/posts/' + @mod._id).end (err, res) ->
				res.status.should.equal(404)
				done()

		it 'should honor good pre_filter hook', (done) ->
			@endpoint.tap 'pre_filter', 'fetch', (args, data, next) ->
				data.number = 5
				next(data)
			.register(@app)

			request(@app).get('/api/posts/' + @mod._id).end (err, res) ->
				res.status.should.equal(200)
				done()

		it 'should honor pre_response hook', (done) ->
			@endpoint.tap 'pre_response', 'fetch', (args, model, next) ->
				delete model.number
				next(model)
			.register(@app)
			request(@app).get('/api/posts/' + @mod._id).end (err, res) ->
				res.status.should.equal(200)
				should.not.exist(res.body.number)
				done()

		it 'should honor pre_response_error hook', (done) ->
			@endpoint.tap 'pre_response_error', 'fetch', (args, err, next) ->
				err.message = 'Foo'
				next(err)
			.register(@app)

			# ID must be acceptable otherwise we'll get a 400 instead of 404
			request(@app).get('/api/posts/abcdabcdabcdabcdabcdabcd').end (err, res) ->
				res.status.should.equal(404)
				res.text.should.equal('Foo')
				done()



	describe 'With middleware', ->
		beforeEach (done) ->
			@endpoint = new mre('/api/posts', 'Post')
			@app = express()
			@app.use(express.bodyParser())
			@app.use(express.methodOverride())

			modClass = mongoose.model('Post')
			mod = modClass
				date:Date.now()
				number:5
				string:'Test'
			mod.save (err, res) =>
				@mod = res
				done()
		afterEach (done) ->
			@mod.remove ->
				done()
		it 'should retrieve with middleware', (done) ->

			@endpoint.addMiddleware('fetch', requirePassword('asdf'))
			@endpoint.register(@app)


			request(@app).get('/api/posts/' + @mod._id).query
				password:'asdf'
			.end (err, res) ->
				res.status.should.equal(200)
				res.body.number.should.equal(5)
				res.body.string.should.equal('Test')
				done()

		it 'should give a 401 with wrong password', (done) ->
			@endpoint.addMiddleware('fetch', requirePassword('asdf'))
			@endpoint.register(@app)


			request(@app).get('/api/posts/' + @mod._id).query
				password:'ffff'
			.end (err, res) ->
				res.status.should.equal(401)
				done()


	describe 'Populate', ->
		beforeEach (done) ->
			@endpoint = new mre('/api/posts', 'Post')
			@app = express()
			@app.use(express.bodyParser())
			@app.use(express.methodOverride())

			modClass = mongoose.model('Post')
			mod = modClass
				date:Date.now()
				number:5
				string:'Test'
				_related:
					_comments:[
							comment:'Asdf1234'
							otherField:5
					]
			mod.cascadeSave (err, res) =>
				@mod = res
				done()
		afterEach (done) ->
			@mod.remove ->
				done()
		it 'should populate on _related', (done) ->

			@endpoint.populate('_comments').register(@app)


			request(@app).get('/api/posts/' + @mod._id).end (err, res) ->
				res.status.should.equal(200)
				res.body.number.should.equal(5)
				res.body.string.should.equal('Test')
				res.body._related._comments.length.should.equal(1)
				res.body._comments.length.should.equal(1)
				res.body._related._comments[0].comment.should.equal('Asdf1234')
				res.body._related._comments[0].otherField.should.equal(5)
				done()
		it 'should populate when specifying fields', (done) ->
			@endpoint.populate('_comments', 'comment').register(@app)

			request(@app).get('/api/posts/' + @mod._id).end (err, res) ->
				res.status.should.equal(200)
				res.body.number.should.equal(5)
				res.body.string.should.equal('Test')
				res.body._related._comments.length.should.equal(1)
				res.body._comments.length.should.equal(1)
				res.body._related._comments[0].comment.should.equal('Asdf1234')
				should.not.exist(res.body._related._comments[0].otherField)
				done()

	describe 'Tracking interface', ->
		beforeEach (done) ->
			@endpoint = new mre('/api/posts', 'Post')
			@app = express()
			@app.use(express.bodyParser())
			@app.use(express.methodOverride())

			done()
		afterEach (done) ->
			if @mod
				@mod.remove ->
					done()
			else
				done()
		it 'should run tracking interface on success', (done) ->

			modClass = mongoose.model('Post')
			mod = modClass
				date:Date.now()
				number:5
				string:'Test'
			mod.save (err, res) =>
				@mod = res

				tracker.interface =
					track: (params) ->
						console.log 'Tracking params', params
						params.response.code.should.equal(200)
						(params.time < 50).should.equal(true)
						done()

				@endpoint.register(@app)


				request(@app).get('/api/posts/' + @mod._id).end (err, res) ->
					console.log 'Ended'
		it 'should run tracking interface on error', (done) ->
			tracker.interface =
				track: (params) ->
					console.log 'Tracking params:', params
					params.response.code.should.equal(400)
					(params.time < 50).should.equal(true)
					done()

			@endpoint.register(@app)


			request(@app).get('/api/posts/asdf').end (err, res) ->
				console.log 'Ended'

		it 'should calculate time based on X-Request-Start header', (done) ->
			tracker.interface =
				track: (params) ->
					params.response.code.should.equal(400)
					params.time.should.be.greaterThan(100)
					params.time.should.be.lessThan(200)
					done()

			@endpoint.register(@app)

			requestStart = moment().valueOf() - 100
			request(@app).get('/api/posts/asdf').set('X-Request-Start', requestStart.toString()).end (err, res) ->
				console.log 'Ended'
