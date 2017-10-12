require('./setup')

const expressionParser = require('../src/expressionParser')

describe('Expression Parser', function () {


  it('should parse metadata correctly', function () {
    expressionParser.parseMetadata(
      "owner=npm;branch=master"
    )
    .should.eql({
      owner: 'npm',
      branch: 'master'
    })
  })

  it('should parse command', function() {
    expressionParser.parseCommand(
      'testCommand --arg1=one --arg2 2 --arg3 /file/path'
    )
    .should.eql({
      command: [
        'testCommand',
        '--arg1=one',
        '--arg2',
        '2',
        '--arg3',
        '/file/path'
      ]
    })
  })

  describe('env block parser', function () {
    it('should differentiate between static and config map variables', function () {
      expressionParser.parseEnvironmentBlock({
        ONE: 'http://test:8080',
        'config-map': {
          TWO: 'a_thing'
        }
      }).should.eql(
        [
          {
            name: 'ONE',
            value: 'http://test:8080'
          },
          {
            name: 'TWO',
            valueFrom: {
              configMapKeyRef: {
                name: 'config-map',
                key: 'a_thing'
              }
            }
          }
        ]
      )
    })
  })

  describe('scale parsers', function () {
    it('should add resource to resources hash from service scale setting', function () {
      const resources = {
        resources: {}
      }

      expressionParser.addResource(resources, 'ram', '> 500Mi < 1Gi')
      expressionParser.addResource(resources, 'cpu', '> 50% < 1.25')

      resources.should.eql({
        resources: {
          requests: {
            memory: '500Mi',
            cpu: 0.50
          },
          limits: {
            memory: '1024Mi',
            cpu: 1.25
          }
        }
      })
    })

    it('should create correct set of scale factors', function () {
      expressionParser.parseScaleFactor(
        "container + 2; cpu > .75 < 1.5; ram > 750Mi < 1.5Gi; storage = data + 5Gi, logs + 2Gi"
      ).should.eql(
        {
          replicas: ['+', '2'],
          resources: {
            requests: {
              memory: '750Mi',
              cpu: 0.75
            },
            limits: {
              memory: '1536Mi',
              cpu: 1.5
            }
          },
          storage: {
            data: '5',
            logs: '2',
          }
        }
      )

      expressionParser.parseScaleFactor(
        "cpu > .75; ram > 750Mi; storage = data + 5Gi"
      ).should.eql(
        {
          resources: {
            requests: {
              memory: '750Mi',
              cpu: 0.75
            }
          },
          storage: {
            data: '5',
          }
        }
      )

      expressionParser.parseScaleFactor(
        "container*2;cpu<1.5;ram<1.5Gi"
      ).should.eql(
        {
          replicas: ['*', '2'],
          resources: {
            limits: {
              memory: '1536Mi',
              cpu: 1.5
            }
          }
        }
      )
    })
  })
})
