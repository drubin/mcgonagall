require('./setup')

const expressionParser = require('../src/expressionParser')

describe('Expression Parser', function () {
  it('should parse metadata correctly', function () {
    expressionParser.parseMetadata(
      'owner=npm;branch=master'
    )
    .should.eql({
      owner: 'npm',
      branch: 'master'
    })
  })

  it('should parse command', function () {
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

  it('should parse security context', function () {
    expressionParser.parseContext(
      'group=2000;user=1000'
    ).should.eql({
      runAsUser: 1000,
      fsGroup: 2000
    })
  })

  describe('volume parser', function () {
    it('should parse config maps', function () {
      expressionParser.parseVolume('vol-name', 'test::file1.txt,file2.txt')
        .should.eql({
          name: 'vol-name',
          configMap: {
            name: 'test',
            items: [
              {
                key: 'file1.txt',
                path: 'file1.txt'
              },
              {
                key: 'file2.txt',
                path: 'file2.txt'
              }
            ]
          }
        })
    })

    it('should parse config maps with permissions', function () {
      expressionParser.parseVolume('vol-name', 'test::file1.txt=subdir/file.txt:0664,file2.txt:0400')
        .should.eql({
          name: 'vol-name',
          configMap: {
            name: 'test',
            items: [
              {
                defaultMode: 436,
                key: 'file1.txt',
                path: 'subdir/file.txt'
              },
              {
                defaultMode: 256,
                key: 'file2.txt',
                path: 'file2.txt'
              }
            ],
            defaultMode: 436
          }
        })
    })

    it('should parse secret', function () {
      expressionParser.parseVolume('vol-name', 'secret::my-secret')
        .should.eql({
          name: 'vol-name',
          secret: {
            secretName: 'my-secret'
          }
        })
    })

    it('should parse secret with permissions', function () {
      expressionParser.parseVolume('vol-name', 'secret::my-secret:0400')
        .should.eql({
          name: 'vol-name',
          secret: {
            secretName: 'my-secret',
            defaultMode: 256
          }
        })
    })

    it('should parse host path', function () {
      expressionParser.parseVolume('vol-name', '/a/path/to/thing')
        .should.eql({
          name: 'vol-name',
          hostPath: {
            path: '/a/path/to/thing',
            type: 'Directory'
          }
        })
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

    it('should differentiate between config map and fieldRef variables', function () {
      expressionParser.parseEnvironmentBlock({
        ONE: 'http://test:8080',
        'fieldRef': {
          TWO: 'spec.nodeName',
          THREE: 'spec.otherThing'
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
              fieldRef: {
                fieldPath: 'spec.nodeName'
              }
            }
          },
          {
            name: 'THREE',
            valueFrom: {
              fieldRef: {
                fieldPath: 'spec.otherThing'
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
            cpu: '500m'
          },
          limits: {
            memory: '1024Mi',
            cpu: '1250m'
          }
        }
      })
    })

    it('should create correct set of scale factors', function () {
      expressionParser.parseScaleFactor(
        'container + 2; cpu > .75 < 1.5; ram > 750Mi < 1.5Gi; storage = data + 5Gi, logs + 2Gi'
      ).should.eql(
        {
          containers: ['+', '2'],
          cpu: '> .75 < 1.5',
          ram: '> 750Mi < 1.5Gi',
          storage: {
            data: '5',
            logs: '2'
          }
        }
      )

      expressionParser.parseScaleFactor(
        'cpu > .75; ram > 750Mi; storage = data + 5Gi'
      ).should.eql(
        {
          cpu: '> .75',
          ram: '> 750Mi',
          storage: {
            data: '5'
          }
        }
      )

      expressionParser.parseScaleFactor(
        'container*2;cpu<1.5;ram<1.5Gi'
      ).should.eql(
        {
          containers: ['*', '2'],
          ram: '<1.5Gi',
          cpu: '<1.5'
        }
      )
    })
  })

  describe('port parsers', function () {
    it('should parse service container port', function () {
      expressionParser.parsePorts({http: '8080'}, true)
        .should.eql([
          {
            name: 'http',
            port: 8080,
            targetPort: 8080,
            protocol: 'TCP'
          }
        ])
    })

    it('should parse service container and target port', function () {
      expressionParser.parsePorts({http: '8000<=8080'}, true)
        .should.eql([
          {
            name: 'http',
            port: 8080,
            targetPort: 8000,
            protocol: 'TCP'
          }
        ])
    })

    it('should parse service container and node port', function () {
      expressionParser.parsePorts({http: '8080=>80'}, true)
        .should.eql([
          {
            name: 'http',
            port: 8080,
            targetPort: 8080,
            nodePort: 80,
            protocol: 'TCP'
          }
        ])
    })

    it('should parse service container, target and node port', function () {
      expressionParser.parsePorts({http: '8000<=8080=>80'}, true)
        .should.eql([
          {
            name: 'http',
            port: 8080,
            targetPort: 8000,
            nodePort: 80,
            protocol: 'TCP'
          }
        ])
    })

    it('should parse container port', function () {
      expressionParser.parsePorts({http: '8080'})
        .should.eql([
          {
            name: 'http',
            containerPort: 8080,
            protocol: 'TCP'
          }
        ])
    })

    it('should parse container and target port', function () {
      expressionParser.parsePorts({http: '8000<=8080'})
        .should.eql([
          {
            name: 'http',
            containerPort: 8000,
            protocol: 'TCP'
          }
        ])
    })

    it('should parse container and node port', function () {
      expressionParser.parsePorts({http: '8080=>80'})
        .should.eql([
          {
            name: 'http',
            containerPort: 8080,
            protocol: 'TCP'
          }
        ])
    })

    it('should parse container, target and node port', function () {
      expressionParser.parsePorts({http: '8000<=8080=>80'})
        .should.eql([
          {
            name: 'http',
            containerPort: 8000,
            protocol: 'TCP'
          }
        ])
    })
  })

  describe.only('probe parsers', function () {
    it('should parse tcp probes correctly', function () {
      expressionParser.parseProbe('port:8080')
        .should.eql({
          tcpSocket: {
            port: 8080
          }
        })

      expressionParser.parseProbe('port:8080,initial=5,period=5,timeout=1')
        .should.eql({
          tcpSocket: {
            port: 8080
          },
          initialDelaySeconds: 5,
          periodSeconds: 5,
          timeoutSeconds: 1
        })

      expressionParser.parseProbe('port:tcp')
        .should.eql({
          tcpSocket: {
            port: 'tcp'
          }
        })

      expressionParser.parseProbe('port:tcp,initial=5,period=5,timeout=1')
        .should.eql({
          tcpSocket: {
            port: 'tcp'
          },
          initialDelaySeconds: 5,
          periodSeconds: 5,
          timeoutSeconds: 1
        })
    })

    it('should parse http probes correctly', function () {
      expressionParser.parseProbe(':8080')
        .should.eql({
          httpGet: {
            path: '/',
            port: 8080
          }
        })

      expressionParser.parseProbe(':8080,initial=5,period=5,timeout=1')
        .should.eql({
          httpGet: {
            path: '/',
            port: 8080
          },
          initialDelaySeconds: 5,
          periodSeconds: 5,
          timeoutSeconds: 1
        })

      expressionParser.parseProbe(':8080/test/url?opt=ping,initial=5,period=5,timeout=1,success=1,failure=3')
        .should.eql({
          httpGet: {
            path: '/test/url?opt=ping',
            port: 8080
          },
          initialDelaySeconds: 5,
          periodSeconds: 5,
          timeoutSeconds: 1,
          successThreshold: 1,
          failureThreshold: 3
        })

      expressionParser.parseProbe(':http')
        .should.eql({
          httpGet: {
            path: '/',
            port: 'http'
          }
        })

      expressionParser.parseProbe(':http,initial=5,period=5,timeout=1')
        .should.eql({
          httpGet: {
            path: '/',
            port: 'http'
          },
          initialDelaySeconds: 5,
          periodSeconds: 5,
          timeoutSeconds: 1
        })

      expressionParser.parseProbe(':http/test/url?opt=ping,initial=5,period=5,timeout=1,success=1,failure=3')
        .should.eql({
          httpGet: {
            path: '/test/url?opt=ping',
            port: 'http'
          },
          initialDelaySeconds: 5,
          periodSeconds: 5,
          timeoutSeconds: 1,
          successThreshold: 1,
          failureThreshold: 3
        })
    })

    it('should parse command probes correctly', function () {
      expressionParser.parseProbe('test command --with /path/args')
        .should.eql({
          exec: {
            command: [
              'test',
              'command',
              '--with',
              '/path/args'
            ]
          }
        })

      expressionParser.parseProbe('test command --with /path/args,initial=10,period=15')
        .should.eql({
          exec: {
            command: [
              'test',
              'command',
              '--with',
              '/path/args'
            ]
          },
          initialDelaySeconds: 10,
          periodSeconds: 15
        })
    })
  })
})
