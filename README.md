# mcgonagall

Transfigures terse cluster and service specifications in TOML into Kubernetes manifests.

[![Build Status][travis-image]][travis-url]
[![Coverage Status][coveralls-image]][coveralls-url]

## Goal

mcgonagall provides TOML specifications that focus on the desired end state in high level terms, separate from technical implementation detail. mcgonagall does not provide implementation of Kubernetes API calls, its focus is solely the "transfiguration" of one specification to another.

## Installation

## Use

## Lib API

mcgonagall's API is simple. 

If you provide only the path to folder or tarball, mcgonagall returns the full cluster specification as JSON.

```js
{
  namespaces: [], // list of namespaces uses in cluster
  levels: [], // sorted array of levels
  order: { // map of cardinal ordering to arrays of service spec keys
  },
  services: { // map of service specs
  },
  configuration: [ // list of configuration specs
  ]
}
```

If you provide a destination folder, mcgonagall will write out a set of folders, files and the cluster spec in the following structure:

```shell
--[./]
  |- cluster.json
  |- {namespace}
  |  |- {deployment|statefulSet|daemonSet}.yml
  |  |- ? service.yml
  |  |- ? account.yml
  |  |- ? roleBinding.yml
  ...
```

If you don't like the folder structure, just start with the cluster spec as JSON and persist it to disk another way.

## CLI

The CLI allows you to get immediate output without having to write any code so you can test your specifications on the command line.

### Output To Standard Out

```shell
mcgonagall transfigure ./input | more

mcgonagall transfigure ./input << ./cluster.json
```

### Output To Full Directory
```shell
mcgonagall transfigure ./input ./output
```

## Specifications

Both specifications attempt to eliminate Kubernetes implementation details where possible and focus on minimal information needed to define our system as a collection of services and configuration that can then be deployed to an available cluster with a list of possible scaling variations depending on target cluster size.

# Specification Format

The specification formats are in TOML. This choice was made partially due to its somewhat forgiving nature and ease of use for the task. In each case, a full example is presented first, and then a break-down of each section follows.

## Cluster Specification

The cluster specification identifies the services, the order in which to create them, scaling factors for target cluster sizes and shared default configuration (if any). The scaling factors are expressed as number of containers to provision per service related to the baseline.

### Example Cluster Specification

```toml
[data.postgres]
  order = 0
  [data.postgres.scale]
    medium = "ram > 500Mi < 750Mi; cpu >.75 < 1.25"
    large = "ram > 750Mi < 1Gi; cpu > 1.00 < 1.5; storage = data + 10Gi"
    enterprise = "ram > 1Gi < 1.5Gi; cpu > 1.25 < 2; storage = data + 20Gi"
[data.redis]
  order = 0
  [data.redis.scale]
    medium = "ram > 500Mi < 1Gi"
    large = "ram > 1Gi < 1.75Gi"
    enterprise = "ram > 1Gi < 2Gi"
[app.myservice]
  order = 1
  [data.myservice.scale]
    medium = "container + 2"
    large = "container + 4"
    enterprise = "container + 8"

[configuration.app.shared]
  database_host = "data.postgres"
  database_port = 5432
  redis_url = "redis://redis.data:6379"
```

### [namespace.service-name]

Each service is represented by a table dictionary in TOML. This value *must* match the namespace and name of the service as it was given in `name` property of the service specification file.

### `order`

The order value specifies what order the service will be created in. This value does not need to be unique and can be thought of as a 'round' during which all services with the same order value will be created in parallel.

The next ordinal round of services will not be sent to the Kubernetes API until the previous round of services have been created successfully. This would respect interdependencies between services and avoid failure/restart cascades across containers which in turn could lead to growing restart cool-downs and effectively malfunctioning clusters.

### `[namespace.service-name.scale]`

The scale table optionally assigns a scaling factors to the container based on the cluster size by a label. The scaling factors are `;` separated and can affect 4 different aspects of the service:

 * container count: `container [operator] [#]`
 * cpu limits: `cpu > [requirement] < [limit]`
 * ram limits: `ram > [requirement] < [limit]`
 * storage provisioned: `storage = [mount] + [increase], ...`


As with the service specifications, RAM is expressed in `Mi` or `Gi` units and CPU limits are either fractional CPU cores or as a percentage using a `%` postfix.

When specifying increases to provisioned storage for stateful services, be sure to match the based on the mount name. Multiple mounts can be increased using a `,` to delimit the list.

> Note: when possible, it's best to limit scaling by container count alone. The example above includes services like postgres and redis specifically because these might be cases where increasing containers might pose an implementation challenge where just increasing resources is a potential alternative.

### `[configuration.namespace.configuration-map-name]`

Multiple configuration maps can be specified, in any namespace, provided that they are prefixed by `configuration`. It is a simple key-value map intended to supply defaults to the services.

The service specifications will still have to opt in to the configuration maps defined in the cluster configurations (see the `env` section).

The purpose of the configuration map here is not to replace etcd as the preferred solution for configuration. Kubernetes does not presently provide any mechanism to alert containers on changes made to configuration maps. Updating running services to reflect configuration changes that rely solely on configuration maps is painful. 

Our containers currently provide a process host, kickerd, that monitors etcd keyspaces for changes and then restarts the process in the event of a relevant change. By combining the two, we can have services that start with sensible defaults for the cluster but respond to customizations stored in etcd.

### Configuration Files

Any configuration files that are mounted via volume mapping will get plugged into a configuration map and loaded into Kubernetes under the same namespace as their containing service.

#### NGiNX Conf

A special case for an `nginx.conf` file is made when it contains the tag `$SERVER_DEFINITIONS$`. Any service specification with a `subdomain` provided will have an nginx block generated for it and placed in the `nginx.conf` file in place of the `$SERVER_DEFINITIONS$`

This provides a simple way to handle dynamic, load-balanced ingress across containers.

## Service Specification

The service specification captures the Docker image, metadata and resources required to create the service. Effort was made to eliminate Kubernetes implementation artifacts and stick to the data, but it is very clear that the service is being described in terms of a container.

### Example Service Specification

The following demonstrates how all the sections would work together. Well over 200 lines of Kubernetes manifests would be derived from this, not to mention the NGiNX configuration block for the reverse proxy used by the cluster.

```toml
name = "app-name.namespace"
stateful = true
daemon = false
serviceAlias = "my-app"
image = "docker-repo/docker-image:latest"
command = "ash -exc node index.js"
metadata = "owner=npm;branch=master"
subdomain = "app-name"
port = 8080
historyLimit = 1

[scale]
  containers = 2
  ram = "> 500Mi < 1Gi"
  cpu = "> 50% < 100%"

[env]
  ONE = "http://test:8080"

  [env.config-map]
    TWO = "a_key"

[ports]
  tcp = "9080"
  http = "8080"
  metrics = "5001.udp"

[mounts]
  data = "/data"
  config = "/etc/mydb"

[volumes]
  config = "actual-config::myapp.conf,auth.cert=cert/auth.cert"

[storage]
  data = "10Gi:exclusive"

[probes]
  ready = ":9999/_monitor/ping,initial=5,period=5,timeout=1,success=1,failure=3"
  live = "mydb test,initial=5,period=30"
```

### top-level properties
Top level properties describe the name, type of service and Docker image that will be deployed.

 * `name` - the service name and namespace in `.` delimited format
 * `image` - the full Docker image specification
 * `stateful` - defaults to `false`; controls whether or not persistent storage will be assigned to the container
 * `command|arguments` - optionally provide the command or arguments to the Docker container
 * `serviceAlias` - optionally changes the default DNS registration for the service
 * `subdomain` - controls if and how the service will be exposed via an nginx container (by convention)
 * `metadata` - optional metadata to tag the service with, important for CD
 * `labelMetadata` - optional, nested label metadata for the specification (part of Kubernetes convention)
 * `loadBalance` - `false` by default. Typically this should only be included on the NGiNX container used to handle ingress.

#### name

This will affect how the service's implementing artifacts in Kubernetes gets named and labeled as well as the default DNS registration. Since getting clever and making these things different values is a "Bad Idea"(tm), having them set in one place is helpful and keeps us out of trouble.

> Note: the `serviceAlias` is primarily intended for use with StatefulSets to serve as the secondary namespace given to each named pod instance in DNS. If this is gibberish to you now, don't worry, after you learn about Kubernetes it will start to make sense.

#### stateful

If the service needs permanent storage (think databases) this should be set to true. This guarantees the service will select the correct manifest type during creation and allows storage provisioning without having to go through the cloud provider's APIs.

#### metadata

The metadata property provides a way to add custom properties to the service's metadata block. It takes a string with key value pairs separated by `;`s. Metadata in Kubernetes is often used to select and filter services. As an example, Hikaru's continuous delivery can make use of metadata to determine if services are eligible for upgrade given what appears to be a compatible Docker image.

### [scale]

Parameters to control how many containers will be provisioned, how much RAM and CPU will be reserved and what limits will be applied for each.

 * `containers` - defaults to 1 (can't be 0)
 * `ram` - optionally specify a minimum and/or maximum memory for the container
 * `cpu` - optionally specify a minimum and/or maximum CPU utilization for the container

`ram` and `cpu` specifications follow the form: '> requirement < limit' where the requirement affects whether or not a container can be scheduled and the limit affects if the container will be stopped if it exceeds the limit.

 * `ram` would be specified in units of `Ki`, `Mi` or `Gi`. 
 * `cpu` would be specified as fractional cores or percentage of a core using a `%` postfix (ex: `50%` is the same as `0.5`).

The containers parameter is intended to be the baseline/starting point/bare minimum number of containers needed for the service to work under normal circumstances. This is not meant to reflect customer/cluster size.

### [env]

Environment variables for the service's container can be specified as direct values or as references to a configuration map's key.

Configuration map references should fall under a block that includes the configuration map's name as a nested key (ex: `[env.my-config-map-name]`).

#### example

```toml
[env]
  AN_ENV = "http://ohlook:8080"

[env.my-config]
  MY_ENV = "config_map_key"
```

### [ports]

The ports block controls which ports will be exposed by the container and registered with DNS. TCP is the assumed protocol unless `.udp` is postfixed to the port.

#### example

```toml
[ports]
  http = "80"
  https = "443"
  idk = "5050.udp"
```

### [mounts]

This block assigns a label to a specific path as a mount point so that files, host paths or a volume claim can later be mounted to it.

#### example

```toml
[mounts]
  storage = "/data"
  config-files = "/etc/my-app"
```

### [volumes]

Most often, these will be flat files that are going to get defined as a configuration map and then mounted to the container on start.

In some rare cases, it might make sense to mount host paths to the container itself.

> WARNING: don't get clever with this, containers move between hosts, you'll shoot your eye out, kid.

#### Flat Files as Volumes

The format for this should follow:

`name-of-the-mount = "config-map-name::file-name-1.ext,file-name-2.ext,file-name-3.ext=relative/path/file-name-3.ext"`

 * the key is the name of the mount
 * the first value in string is an arbitrary, but unique name within the namespace to assign to this set of files
 * after the `::`, the list of files to be uploaded and mounted should be comma delimited
 * if the filename should be different in the container or needs to be in a path relative to the mount's location, provide that using an `=`

#### Host Paths as Volumes

Similar to the flat file approach, use the mount name as the key and the path on the host as the value:

`name-of-the-mount = "/path/on/the/host"`

#### example:
```toml
[volumes]
  config-files = "actual-config::mydb.conf,ssl.cert=cert/ssl.cert"
  host-mount = "/tmp/ohno"
```

### [storage]

The storage block enumerates persistent storage requirements for services that have specified `stateful = true`.

The key name should match the key name of a mount in the `[mounts]` block and the value should follow the form:

`[size]Gi:[access]`

where the `size` is the number of Gigabytes required and `access` is either `shared` or `exclusive`

#### example

```toml
[storage]
  data = "10Gi:exclusive"
```

### [probes]

Probes are an optional (but recommended) addition that allow Kubernetes to determine when the service is ready to accept requests (using a ready probe) as well as determine if a container should be restarted (using a live probe).

Each probe can use either an HTTP check or use a shell command within the container that will rely on the exit code to determine success or failure of the check.

The key should either be `ready` or `live` to specify the purpose of the probe and the value should either be the relative URL beginning with the port for an HTTP probe or a command line relative to the container's working directory.

Each check can also support the following, optional, comma delimited, arguments to adjust its behavior (all time units are in seconds):

 * `initial` - the initial amount of time to wait before trying the probe
 * `period` - the amount of time to wait between checking
 * `timeout` - the amount of time before a lack of response counts as a failure
 * `success` - the number of successes required after a failure to count as success
 * `failure` - the number of failed checks after a success before treated the service as failed

#### example

```toml
[probes]
  ready = ":9999/_monitor/ping,initial=5,period=5,timeout=1,success=1,failure=3"
  live = "mydb test,initial=5,period=30"
```

### [security]

The security section exists to address the new and growing feature set around accounts, roles and role bindings in Kubernetes.

The properties of `account` and `role` allow you to specify the account and role requirements for the service so that ServiceAccount, Role and RoleBinding resources will be created on your behalf where necessary.

The example below demonstrates how to create a `heapster` account and assign it to the `ClusterRole` feature:

```toml
[security]
  account = "heapster"
  role = "ClusterRole;system:heapster"
```

[travis-url]: https://travis-ci.com/npm/mcgonagall
[travis-image]: https://travis-ci.com/npm/mcgonagall.svg?token=nx7pjhpjyWEn4WyoMujZ&branch=master
[coveralls-url]: https://coveralls.io/github/npm/mcgonagall
[coveralls-image]: https://coveralls.io/repos/github/npm/mcgonagall/badge.svg?t=A7I8EA
