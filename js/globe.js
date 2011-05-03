/** -*- compile-command: "jslint-cli globe.js" -*-
 *
 * Authors:
 *  Cedric Pinson <cedric.pinson@plopbyte.com>
 */
var Globe = function(canvas, options)
{
    var hex2num = function(hex) {
        if(hex.charAt(0) == "#") { hex = hex.slice(1); }//Remove the '#' char - if there is one.
        hex = hex.toUpperCase();
        var hex_alphabets = "0123456789ABCDEF";
        var value = new Array(4);
        var k = 0;
        var int1,int2;
        for(var i=0;i<8;i+=2) {
	    int1 = hex_alphabets.indexOf(hex.charAt(i));
	    int2 = hex_alphabets.indexOf(hex.charAt(i+1)); 
	    value[k] = (int1 * 16) + int2;
            value[k] = value[k]/255.0;
	    k++;
        }
        return(value);
    };

    this.landColor = hex2num("#028482FF"); //[ 2/255.0, 132/255.0, 130/255.0,1];
    this.landFrontColor = hex2num("#7ABA7AAA"); //[122.0/255.0, 0.6470588235294118,0.7647058823529411,0.8666666666666667];

    this.countryColor = hex2num("#000000FF"); //[0.0,0.0,0.0,1];


    var w,h;
    w = canvas.width;
    h = canvas.height;
    if (options !== undefined) {
        if (options.globeBackColor !== undefined) {
            this.landColor = hex2num(options.globeBackColor);
        }

        if (options.globeFrontColor !== undefined) {
            this.landFrontColor = hex2num(options.globeFrontColor);
        }

        if (options.globeLinesColor !== undefined) {
            this.countryColor = hex2num(options.globeLinesColor);
        }

        if (options.width !== undefined) {
            w = options.width;
        }
        if (options.height !== undefined) {
            h = options.height;
        }
    }

    
    if (w === undefined || h === undefined) {
        var size = this.getWindowSize();
        w = size.w;
        h = size.h;
    }

    this.canvas = canvas;
    canvas.width = w;
    canvas.height = h;
    var ratio = canvas.width/canvas.height;

    try {
        this.viewer = new osgViewer.Viewer(canvas);
        this.viewer.init();
        var manipulator = new osgGA.OrbitManipulator2(options);
        this.viewer.setupManipulator(manipulator);

        this.viewer.view.setProjectionMatrix(osg.Matrix.makePerspective(60, ratio, 1000.0, 100000000.0));
        this.viewer.manipulator.setDistance(2.5*6378137);
        this.viewer.manipulator.setMaxDistance(2.5*6378137);
        this.viewer.manipulator.setMinDistance(6378137);

        this.viewer.run = function() {
            if (this.scene === undefined) {
                this.scene = new osg.Node();
            }
            this.view.addChild(this.scene);
            var that = this;
            var render = function() {
                window.requestAnimationFrame(render, that.canvas);
                that.frame();
            };
            render();
        };

        var result = this.createScene();
        this.items = result.items;
        this.viewer.setScene(result.root);
        this.viewer.run();
    } catch (er) {
        osg.log("exception in osgViewer " + er);
    }

};

Globe.prototype = {
    addImage: function(latitude, longitude, image, options, cb) {
        var texture = new osg.Texture();
        texture.setMinFilter('LINEAR');
        texture.setImage(image);

        var w = 500000;
        var h = 500000;
        var node = new osg.MatrixTransform();
        var geom = osg.createTexturedQuad(-w/2.0, -h/2.0, 0,
                                          w, 0, 0,
                                          0, h, 0);
        node.addChild(geom);
        var stateSet = this.getItemShader();
        stateSet.setTextureAttributeAndMode(0, texture);

        var uniform = osg.Uniform.createInt1(0.0, "Texture0");
        geom.setStateSet(stateSet);
        node.uniform = stateSet.getUniformMap()['fragColor'];
        node.setUpdateCallback(this.getItemUpdateCallback());
        node.itemType = "Item";

        if (this.ellipsoidModel === undefined) {
            this.ellipsoidModel = new osg.EllipsoidModel();
        }

        var matrix = this.ellipsoidModel.computeLocalToWorldTransformFromLatLongHeight(latitude * Math.PI/180.0, longitude * Math.PI/180.0, 1000);
        node.originalMatrix = osg.Matrix.copy(matrix);
        node.setMatrix(matrix);
        
        node.name = image.src;

        node.setNodeMask(~0);
        node.itemToIntersect = true;
        delete node.startTime;
        delete node.duration;

        // add the node to the sceneGraph
        this.items.addChild(node);

        node.dispose = function() {
            this.updateCallback = undefined;
            this.removeChildren();
            while(this.parents.length > 0) {
                this.parents[0].removeChildren(this);
            }
        };
        return node;
    },
    dispose: function() {
        while (this.items.getChildren().length > 0 ) {
            this.items.getChildren()[0].dispose();
        }
    },
    getWindowSize: function() {
        var myWidth = 0, myHeight = 0;
        
        if( typeof( window.innerWidth ) == 'number' ) {
            //Non-IE
            myWidth = window.innerWidth;
            myHeight = window.innerHeight;
        } else if( document.documentElement && ( document.documentElement.clientWidth || document.documentElement.clientHeight ) ) {
            //IE 6+ in 'standards compliant mode'
            myWidth = document.documentElement.clientWidth;
            myHeight = document.documentElement.clientHeight;
        } else if( document.body && ( document.body.clientWidth || document.body.clientHeight ) ) {
            //IE 4 compatible
            myWidth = document.body.clientWidth;
            myHeight = document.body.clientHeight;
        }
        return { 'w': myWidth, 'h': myHeight };
    },

    getWorldProgram: function() {
        if (this.WorldProgram === undefined) {
            var vertexshader = [
                "",
                "#ifdef GL_ES",
                "precision highp float;",
                "#endif",
                "attribute vec3 Vertex;",
                "uniform mat4 ModelViewMatrix;",
                "uniform mat4 ProjectionMatrix;",
                "uniform vec4 fragColor;",
                "void main(void) {",
                "  gl_Position = ProjectionMatrix * ModelViewMatrix * vec4(Vertex,1.0);",
                "}",
                ""
            ].join('\n');

            var fragmentshader = [
                "",
                "#ifdef GL_ES",
                "precision highp float;",
                "#endif",
                "uniform vec4 fragColor;",
                "void main(void) {",
                "gl_FragColor = fragColor;",
                "}",
                ""
            ].join('\n');

            var program = osg.Program.create(
                osg.Shader.create(gl.VERTEX_SHADER, vertexshader),
                osg.Shader.create(gl.FRAGMENT_SHADER, fragmentshader));

            this.WorldProgram = program;
        }
        return this.WorldProgram;
    },

    getWorldShaderBack: function() {
        var stateset = new osg.StateSet();
        var uniform = osg.Uniform.createFloat4(this.landColor,"fragColor");
        stateset.setAttributeAndMode(this.getWorldProgram());
        stateset.addUniform(uniform);
        return stateset;
    },

    getWorldShaderFront: function () {
        var stateset = new osg.StateSet();
        var uniform = osg.Uniform.createFloat4(this.landFrontColor,"fragColor");
        stateset.setAttributeAndMode(this.getWorldProgram());
        stateset.addUniform(uniform);
        return stateset;
    },


    getCountryShader: function() {
        var vertexshader = [
            "",
            "#ifdef GL_ES",
            "precision highp float;",
            "#endif",
            "attribute vec3 Vertex;",
            "uniform mat4 ModelViewMatrix;",
            "uniform mat4 ProjectionMatrix;",
            "void main(void) {",
            "  gl_Position = ProjectionMatrix * ModelViewMatrix * vec4(Vertex,1.0);",
            "}",
            ""
        ].join('\n');

        var fragmentshader = [
            "",
            "#ifdef GL_ES",
            "precision highp float;",
            "#endif",
            "uniform vec4 fragColor;",
            "void main(void) {",
            "gl_FragColor = fragColor;",
            "}",
            ""
        ].join('\n');

        var program = osg.Program.create(
            osg.Shader.create(gl.VERTEX_SHADER, vertexshader),
            osg.Shader.create(gl.FRAGMENT_SHADER, fragmentshader));
        var stateset = new osg.StateSet();
        var uniform = osg.Uniform.createFloat4(this.countryColor,"fragColor");
        stateset.setAttributeAndMode(program);
        stateset.addUniform(uniform);
        return stateset;
    },

    getItemUpdateCallback: function() {
        var that = this;
        if (this.itemUpdateCallback === undefined) {
            var UpdateCallback = function() {
                this.limit = osg.WGS_84_RADIUS_EQUATOR*0.5;
                this.manipulator = that.viewer.getManipulator();
            };
            UpdateCallback.prototype = {
                update: function(node, nv) {
                    var ratio = 0;
                    var currentTime = nv.getFrameStamp().getSimulationTime();
                    if (node.startTime === undefined) {
                        node.startTime = currentTime;
                        if (node.duration === undefined) {
                            node.duration = 5.0;
                        }
                    }

                    var dt = currentTime - node.startTime;
                    if (dt > node.duration) {
                        node.setNodeMask(0);
                        return;
                    }
                    ratio = dt/node.duration;
                    if (node.originalMatrix) {
                        var scale;
                        if (dt > 1.0) {
                            scale = 1.0;
                        } else {
                            scale = osgAnimation.EaseOutElastic(dt);
                        }

                        scale = scale * (this.manipulator.height/osg.WGS_84_RADIUS_EQUATOR);
                        if (this.manipulator.height > this.limit) {
                            var rr = 1.0 - (this.manipulator.height-this.limit) * 0.8/(2.5*osg.WGS_84_RADIUS_EQUATOR-this.limit);
                            scale *= rr;
                        }
                        node.setMatrix(osg.Matrix.mult(node.originalMatrix, osg.Matrix.makeScale(scale, scale, scale)));
                    }

                    var value = (1.0 - osgAnimation.EaseInQuad(ratio));
                    var uniform = node.uniform;
                    var c = [value, value, value, value];
                    uniform.set(c);
                    node.traverse(nv);
                }
            };
            this.itemUpdateCallback = new UpdateCallback();
        }
        return this.itemUpdateCallback;
    },
    getItemShader: function() {
        if (this.ItemShader === undefined) {
            var vertexshader = [
                "",
                "#ifdef GL_ES",
                "precision highp float;",
                "#endif",
                "attribute vec3 Vertex;",
                "attribute vec2 TexCoord0;",
                "uniform mat4 ModelViewMatrix;",
                "uniform mat4 ProjectionMatrix;",
                "varying vec2 FragTexCoord0;",
                "void main(void) {",
                "  gl_Position = ProjectionMatrix * ModelViewMatrix * vec4(Vertex,1.0);",
                "  FragTexCoord0 = TexCoord0;",
                "}",
                ""
            ].join('\n');

            var fragmentshader = [
                "",
                "#ifdef GL_ES",
                "precision highp float;",
                "#endif",
                "uniform vec4 fragColor;",
                "uniform sampler2D Texture0;",
                "varying vec2 FragTexCoord0;",
                "void main(void) {",
                "vec4 color = texture2D( Texture0, FragTexCoord0.xy);",
                "float a = color[3];",
                "color = color*a;",
                "color[3]= a;",
                "gl_FragColor = color*fragColor[0];",
                "}",
                ""
            ].join('\n');

            var program = osg.Program.create(
                osg.Shader.create(gl.VERTEX_SHADER, vertexshader),
                osg.Shader.create(gl.FRAGMENT_SHADER, fragmentshader));

            this.ItemShader = program;
        }
        var stateset = new osg.StateSet();
        var uniform = osg.Uniform.createFloat4([1.0,
                                                0.0,
                                                1.0,
                                                0.5],"fragColor");
        stateset.setAttributeAndMode(this.ItemShader);
        //stateset.setAttributeAndMode(new osg.BlendFunc('ONE', 'ONE_MINUS_SRC_ALPHA'));
        stateset.addUniform(uniform);
        return stateset;
    },

    createScene: function() {
        var viewer = this.viewer;

        var optionsURL = function() {
            var vars = [], hash;
            var hashes = window.location.href.slice(window.location.href.indexOf('?') + 1).split('&');
            for(var i = 0; i < hashes.length; i++)
            {
                hash = hashes[i].split('=');
                vars.push(hash[0]);
                vars[hash[0]] = hash[1];
            }
            return vars;
        };

        viewer.view.setClearColor([0,0,0,0]);


        var canvas = this.canvas;
        var ratio = canvas.width/canvas.height;

        var scene = new osg.Node();

        var world = osg.ParseSceneGraph(getWorld());
        var country = osg.ParseSceneGraph(getCountry());
        var coast = osg.ParseSceneGraph(getCoast());

        var backSphere = new osg.Node();
        backSphere.addChild(world);

        var frontSphere = new osg.Node();
        frontSphere.addChild(world);

        backSphere.setStateSet(this.getWorldShaderBack());
        backSphere.setNodeMask(2);
        backSphere.getOrCreateStateSet().setAttributeAndMode(new osg.CullFace('FRONT'));

        frontSphere.setStateSet(this.getWorldShaderFront());
        frontSphere.setNodeMask(2);
        frontSphere.getOrCreateStateSet().setAttributeAndMode(new osg.CullFace('BACK'));
        frontSphere.getOrCreateStateSet().getUniformMap()['fragColor'].set(this.landFrontColor);

        country.addChild(coast);


        scene.addChild(backSphere);
        scene.addChild(frontSphere);
        scene.addChild(country);
        var items = new osg.Node();
        scene.addChild(items);
        items.getOrCreateStateSet().setAttributeAndMode(new osg.Depth('DISABLE'));
        items.getOrCreateStateSet().setAttributeAndMode(new osg.BlendFunc('ONE', 'ONE_MINUS_SRC_ALPHA'));

        backSphere.getOrCreateStateSet().setAttributeAndMode(new osg.BlendFunc('ONE', 'ONE_MINUS_SRC_ALPHA'));
        frontSphere.getOrCreateStateSet().setAttributeAndMode(new osg.BlendFunc('ONE', 'ONE_MINUS_SRC_ALPHA'));

        country.setStateSet(this.getCountryShader());
        //    country.getOrCreateStateSet().setAttributeAndMode(new osg.BlendFunc('ONE', 'ONE'));
        country.getOrCreateStateSet().setAttributeAndMode(new osg.Depth('ALWAYS', 0, 1.0, false));

        var createGoToLocation = function(location) {
            var f = function(event) {
                viewer.manipulator.goToLocation(location.lat, location.lng);
            };
            return f;
        };

        viewer.manipulator.update(-2.0, 0);

        return { root: scene, items: items};
    }
};


osgGA.OrbitManipulator2 = function (options) {
    this.ellipsoidModel = new osg.EllipsoidModel();
    this.distance = 25;
    this.target = [ 0,0, 0];
    this.eye = [ 0, this.distance, 0];
    this.rotation = osg.Matrix.makeRotate(-Math.PI/3.0, 1,0,0); // osg.Quat.makeIdentity();
    this.up = [0, 0, 1];
    this.time = 0.0;
    this.dx = 0.0;
    this.dy = 0.0;
    this.buttonup = true;
    this.scale = 1.0;
    this.targetDistance = this.distance;
    this.currentMode = "rotate";

    this.measureDeltaX = 0;
    this.measureDeltaY = 0;
    this.measureClientY = 0;
    this.measureClientX = 0;
    this.measureTime = 0;
    this.direction = 0.0;

    this.height = 0;
    this.motionWhenRelease = 1.0;

    this.maxDistance = 0;
    this.minDistance = 0;
    this.goToLocationRunning = false;

    this.contactsIntialDistance =1.0;
    this.nbContacts = 0;
    this.contacts = [];
    this.contactsPosition = [];
    this.zoomModeUsed = false;

    this.scaleFactor = 10.0;
    if (options !== undefined && options.rotationSpeedFactor !== undefined) {
        if (options.rotationSpeedFactor !== 0.0) {
            this.scaleFactor /= options.rotationSpeedFactor;
        }
    }

    this.minAutomaticMotion = 0.015;
    if (options !== undefined && options.rotationIdleSpeedFactor !== undefined) {
        if (options.rotationIdleSpeedFactor !== 0.0) {
            this.minAutomaticMotion *= options.rotationIdleSpeedFactor;
        }
    }

};

osgGA.OrbitManipulator2.prototype = {
    panModel: function(dx, dy) {

        var inv = osg.Matrix.inverse(this.rotation);
        var x = [ osg.Matrix.get(inv, 0,0), osg.Matrix.get(inv, 0,1), 0 ];
        x = osg.Vec3.normalize(x);
        var y = [ osg.Matrix.get(inv, 1,0), osg.Matrix.get(inv, 1,1), 0 ];
        y = osg.Vec3.normalize(y);

        osg.Vec3.add(this.target, osg.Vec3.mult(x, -dx), this.target);
        osg.Vec3.add(this.target, osg.Vec3.mult(y, -dy), this.target);
    },

    getScaleFromHeight: function(eye) {
        var distFromSurface = eye;
        var WGS_84_RADIUS_EQUATOR = 6378137.0;
        var scaleOneFromSurface = WGS_84_RADIUS_EQUATOR;
        var ratio = distFromSurface/scaleOneFromSurface;
        // clamp the scale
        if (ratio > 0.8) {
            ratio = 0.8;
        }
        //osg.log(ratio);
        var scale = ratio/20.0;
        return scale;
    },

    computeRotation: function(dx, dy) {
        
        var scale = 1.0/10.0;
        scale = this.scale;

        var of = osg.Matrix.makeRotate(dx * scale, 0,0,1);
        var r = osg.Matrix.mult(this.rotation, of);

        of = osg.Matrix.makeRotate(dy * scale/2.0, 1,0,0);
        var r2 = osg.Matrix.mult(of,r);

        // test that the eye is not too up and not too down to not kill
        // the rotation matrix
        var eye = osg.Matrix.transformVec3(osg.Matrix.inverse(r2), [0, 0, this.distance]);
        if (eye[2] > 0.99*this.distance || eye[2] < -0.99*this.distance) {
            //discard rotation on y
            this.rotation = r;
            return;
        }
        this.rotation = r2;
    },

    
    goToLocation: function(lat, lng) {
        // already running switch to new location
        var pos3d = this.ellipsoidModel.convertLatLongHeightToXYZ(lat*Math.PI/180.0, lng*Math.PI/180.0);
        var lookat = osg.Matrix.makeLookAt(pos3d, [0,0,0], [0,0,-1]);
        var q = osg.Matrix.getRotate(lookat);

        if (this.goToLocationRunning) {
            var qStart = this.getGoToLocationQuaternion();
            this.rotation = osg.Matrix.makeRotateFromQuat(osg.Quat.conj(qStart));
        }
        this.targetRotation = q;
        this.goToLocationTime = (new Date()).getTime();
        this.goToLocationRunning = true;

        this.disableAutomaticMotion(4.0);
    },

    update: function(dx, dy) {
        if (dx > 0) {
            this.direction = 1.0;
        } else if (dx < 0) {
            this.direction = -1.0;
        }
        this.dx += dx;
        this.dy += dy;

        if (Math.abs(dx) + Math.abs(dy) > 0.0) {
            this.time = (new Date()).getTime();
        }
    },

    dblclick: function() {
        //this.goToLocation(-3.948104, -54.045366);
        return true;
    },
    updateWithDelay: function() {
        var f = 1.0;
        var dt;
        var max = 2.0;
        var dx = this.dx;
        var dy = this.dy;
        if (this.buttonup) {
            f = 0.0;
            dt = ((new Date()).getTime() - this.time)/1000.0;
            if (dt < max) {
                f = 1.0 - osgAnimation.EaseOutQuad(dt/max);
            }
            dx *= f;
            dy *= f;

            var min = this.minAutomaticMotion;
            if (Math.abs(dx) < min) {
                dx = min*this.direction * this.motionWhenRelease;
                this.dx = dx;
            }

            var val = Math.abs(this.dx) + Math.abs(this.dy);

        } else {
            this.dx = 0;
            this.dy = 0;
        }

        if (Math.abs(dx) + Math.abs(dy) > 0.0) {
            this.computeRotation(dx, dy);
        }
    },

    disableAutomaticMotion: function(duration) {
        var min = this.minAutomaticMotion;
        this.motionWhenRelease = 0.0;
        if (this.timeout === undefined) {
            var that = this;
            this.timeout = true;
            window.setTimeout(function() {
                if (Math.abs(that.dx) + Math.abs(that.dy) === 0.0) {
                    that.motionWhenRelease = 1.0;
                    that.update(min+0.0001,0);
                }
                delete that.timeout;
            }, duration * 1000);
        }
    },

    mouseup: function(ev) {
        this.buttonup = true;
        
        var time = (new Date()).getTime()/1000.0;
        if (time - this.lastMotion > 0.05) {
            this.dx = 0;
            this.dy = 0;
            this.disableAutomaticMotion(4.0);
        } else {
            this.dx = this.lastDeltaX;
            this.dy = this.lastDeltaY;
            this.motionWhenRelease = 1.0;
        }

        //osg.log(this.dx + " " + this.dy);
    },
    mousemove: function(ev) {

        if (this.buttonup === true) {
            return;
        }

        var curX;
        var curY;
        var deltaX;
        var deltaY;
        var pos = this.convertEventToCanvas(ev);
        curX = pos[0];
        curY = pos[1];

        deltaX = (this.clientX - curX) / this.scaleFactor;
        deltaY = (this.clientY - curY) / this.scaleFactor;
        this.clientX = curX;
        this.clientY = curY;

        var time = (new Date()).getTime()/1000.0;
        this.lastMotion = time;
        this.lastDeltaX = deltaX;
        this.lastDeltaY = deltaY;

        this.update(deltaX, deltaY);
    },
    mousedown: function(ev) {
        var pos = this.convertEventToCanvas(ev);
        this.clientX = pos[0];
        this.clientY = pos[1];
        this.pushButton();
        this.measureTime = (new Date()).getTime()/1000.0;
    },

    touchDown: function(ev) {
        if (this.nbContacts >= 2 || (this.nbContacts < 2 && this.zoomModeUsed === true)) {
            return;
        }
        this.contacts[this.nbContacts] = ev.streamId;
        if (this.contactsPosition[this.nbContacts] === undefined) {
            this.contactsPosition[this.nbContacts] = {};
        }
        this.contactsPosition[this.nbContacts].x = ev.clientX;
        this.contactsPosition[this.nbContacts].y = ev.clientY;
        this.nbContacts++;
        if (this.nbContacts === 1) {
            this.mousedown(ev);
        } else {

            var x1 = this.contactsPosition[0].x;
            var x2 = this.contactsPosition[1].x;
            var y1 = this.contactsPosition[0].y;
            var y2 = this.contactsPosition[1].y;
            var dist = Math.sqrt( (x2-x1)*(x2-x1) + (y2-y1)*(y2-y1) );
            this.contactsIntialDistance = dist;
			//osg.log("2 contacts " + this.contactsIntialDistance);
			}
    },
    touchUp: function(ev) {
        if (this.zoomModeUsed === false && this.nbContacts === 1) {
			//osg.log("use a mouse up ");
            this.mouseup(ev);
        }
        this.nbContacts--;
		if (this.nbContacts === 0) {
			this.zoomModeUsed = false;
		}
    },
    touchMove: function(ev) {
        if (this.nbContacts === 2) {
            // zoom mode
	    this.zoomModeUsed = true;
            if (this.contacts[0] === ev.streamId) {
                if (this.contactsPosition[0] === undefined) {
                    this.contactsPosition[0] = {};
                }
                this.contactsPosition[0].x = ev.clientX;
                this.contactsPosition[0].y = ev.clientY;
            } else if (this.contacts[1] === ev.streamId) {
                if (this.contactsPosition[1] === undefined) {
                    this.contactsPosition[1] = {};
                }
                this.contactsPosition[1].x = ev.clientX;
                this.contactsPosition[1].y = ev.clientY;
            } else {
                osg.log("dont find the contact something weird");
            }
            var x1 = this.contactsPosition[0].x;
            var x2 = this.contactsPosition[1].x;
            var y1 = this.contactsPosition[0].y;
            var y2 = this.contactsPosition[1].y;
            var dist = Math.sqrt( (x2-x1)*(x2-x1) + (y2-y1)*(y2-y1) );
            var ratio = this.contactsIntialDistance/dist;
	    //osg.log("2 cts " + ratio);
            this.contactsIntialDistance = dist;
            var h = this.height;
            //this.distance = this.targetDistance;
            this.targetDistance += (ratio - 1.0) * this.scale * 50.0* 6378137/2.0;
	    if (this.maxDistance !== 0.0 && this.targetDistance > this.maxDistance) {
		this.targetDistance = this.maxDistance;
	    }
	    if (this.minDistance !== 0.0 && this.targetDistance < this.minDistance) {
		this.targetDistance = this.minDistance;
	    }
	    this.distance = this.targetDistance;
	    //osg.log("target distance " + this.targetDistance);
            this.timeMotion = (new Date()).getTime();
            
        } else {
            // rotation
	    if (this.zoomModeUsed === false) {
		this.mousemove(ev);
	    }
        }
    },

    setDistance: function(d) {
        this.distance = d;
        this.targetDistance = this.distance;
    },
    setMaxDistance: function(d) {
        this.maxDistance =  d;
    },
    setMinDistance: function(d) {
        this.minDistance =  d;
    },

    getHeight: function() {
        var h;
        var lat;
        var lng;
        
        var llh = this.ellipsoidModel.convertXYZToLatLongHeight(this.eye[0], this.eye[1], this.eye[2]);
        return llh[2];
        //osg.log("height " + llh[2] + " distance " + this.distance);
    },

    distanceIncrease: function() {
        var h = this.height;
        var currentTarget = this.targetDistance;
        var newTarget = currentTarget + h/10.0;
        if (this.maxDistance > 0) {
            if (newTarget > this.maxDistance) {
                newTarget = this.maxDistance;
            }
        }
        this.distance = currentTarget;
        this.targetDistance = newTarget;
        this.timeMotion = (new Date()).getTime();
    },
    distanceDecrease: function() {
        var h = this.height;
        var currentTarget = this.targetDistance;
        var newTarget = currentTarget - h/10.0;
        if (this.minDistance > 0) {
            if (newTarget < this.minDistance) {
                newTarget = this.minDistance;
            }
        }
        this.distance = currentTarget;
        this.targetDistance = newTarget;
        this.timeMotion = (new Date()).getTime();
    },
    
    pushButton: function() {
        this.dx = this.dy = 0;
        this.buttonup = false;

        //var hit = this.getIntersection();
        //this.pushHit = hit;
    },

    getIntersection: function() {
        var hits = this.view.computeIntersections(this.clientX, this.clientY, 1);
        var l = hits.length;
        if (l === 0 ) {
            return undefined;
        }
        hits.sort(function(a,b) {
            return a.ratio - b.ratio;
        });

        // use the first hit
        var hit = hits[0].nodepath;
        var l2 = hit.length;
        var itemSelected;
        var name;
        while (l2-- >= 0) {
            if (hit[l2].itemToIntersect !== undefined) {
                name = hit[l2].getName();
                //itemSelected = hit[l2].children[0].getUpdateCallback();
                itemSelected = hit[l2];
                break;
            }
        }
        return { 'name': name, 
                 'item': itemSelected };
    },

    getGoToLocationQuaternion: function() {
        var goToLocationDuration = 2.0;
        target = this.target;
        distance = this.distance;

        var q0 = osg.Matrix.getRotate(this.rotation);
        var q1 = this.targetRotation;

        var t = ((new Date()).getTime() - this.goToLocationTime)/1000.0;
        if (t > goToLocationDuration) {
            t = 1.0;
            this.goToLocationRunning = false;
            this.rotation = osg.Matrix.makeRotateFromQuat(q1);
            this.dx = 0;
            this.dy = 0;
        } else {
            t = osgAnimation.EaseOutCubic(t/goToLocationDuration);
        }
        var qCurrent = osg.Quat.slerp(t, q0, q1);
        osg.Quat.conj(qCurrent, qCurrent);
        return qCurrent;
    },

    getInverseMatrix: function () {
        var inv;
        var target;
        var distance;
        var eye;
        if (this.goToLocationRunning === true ) {
            distance = this.distance;
            target = this.target;
            var qCurrent = this.getGoToLocationQuaternion();
            eye = osg.Matrix.transformVec3(osg.Matrix.makeRotateFromQuat(qCurrent), [0, 0, distance]);
            this.eye = eye;
            inv = osg.Matrix.makeLookAt(osg.Vec3.add(target,eye), target, [0,0,1]);

        } else {

            this.updateWithDelay();

            target = this.target;
            distance = this.distance;

            if (this.timeMotion !== undefined) { // we have a camera motion event
                var dt = ((new Date()).getTime() - this.timeMotion)/1000.0;
                var motionDuration = 1.0;
                if (dt < motionDuration) {
                    var r = osgAnimation.EaseOutQuad(dt/motionDuration);
                    if (this.targetMotion) {
                        target = osg.Vec3.add(this.target, osg.Vec3.mult(osg.Vec3.sub(this.targetMotion, this.target), r));
                    }
                    if (this.targetDistance) {
                        distance = this.distance + (this.targetDistance - this.distance) * r;
                    }
                } else {
                    if (this.targetMotion) {
                        this.target = this.targetMotion;
                        target = this.targetMotion;
                    }
                    if (this.targetDistance) {
                        this.distance = this.targetDistance;
                        distance = this.targetDistance;
                    }
                    this.timeMotion = undefined;
                }
            }
            
            //this.targetMotion
            eye = osg.Matrix.transformVec3(osg.Matrix.inverse(this.rotation), [0, 0, distance]);
            this.eye = eye;
            inv = osg.Matrix.makeLookAt(osg.Vec3.add(target,eye), target, [0,0,1]);
        }

        this.height = this.getHeight();
        this.scale = this.getScaleFromHeight(this.height);
//        osg.log("height " + this.height + " scale " + this.height/6378137.0);
        return inv;
    }

};

