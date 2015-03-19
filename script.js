function Float(elem){
    var that = this;
    if(elem) {
        this.elem = elem;
        this.elem.addEventListener("click", function(bitElem) {
            if(bitElem.target.nodeName != "SPAN") {
                return;
            }

            var id = bitElem.target.id.substring(3);
            that.flipBit(Number(id));
        });
    }
    this.buffer = new ArrayBuffer(8);
    this.floatBuffer = new Float64Array(this.buffer);
    this.uintBuffer = new Uint8Array(this.buffer);
    this.floatBuffer[0] = 0;
    this.onValueChanged = null;
}

Float.prototype.render = function() {
    this.elem.innerHTML = "";
    this.elem.className = 'floatDiv';

    for(var i = 63; i >= 0; i--) {
        var span = document.createElement('span');
        span.id = "bit" + i;
        span.textContent = String(i);
        if(i === 63) {
            span.className = 'floatSign';
        } else if(i >= 52) {
            span.className = 'floatExponent';
        } else {
            span.className = 'floatMantissa';
        }
        if(this.getBit(i)) {
            span.className += ' floatSelected';
        }
        this.elem.appendChild(span);
    }
}

Float.prototype.setNum = function(num) {
    this.floatBuffer[0] = num;
    if(this.elem) {
        this.render();
    }

    if(this.onValueChanged) {
        this.onValueChanged(this.floatBuffer[0]);
    }
}

Float.prototype.getNum = function() {
    return this.floatBuffer[0];
}

Float.prototype.flipBit = function(index) {
    var current = this.getBit(index);
    this.setBit(index, !current);
}

Float.prototype.setBit = function(index, value) {
    var offset = this.getBitLocation(index);
    var byteOffset = offset['byte'];

    if(value) {
        this.uintBuffer[byteOffset] = this.uintBuffer[byteOffset] | offset['bitValue'];
    } else {
        var clearVal = 0xFF - offset['bitValue'];
        this.uintBuffer[byteOffset] = this.uintBuffer[byteOffset] & clearVal;
    }

    if(this.elem) {
        this.renderBit(index, value);
    }

    if(this.onValueChanged) {
        this.onValueChanged(this.floatBuffer[0]);
    }
}

Float.prototype.getBit = function(index) {
    var offset = this.getBitLocation(index);
    var byteValue = this.uintBuffer[offset['byte']];
    var bitValue = byteValue & (offset['bitValue']);
    return bitValue;
}

Float.prototype.getBitLocation = function(index) {
    index = +index;
    if(index > 63 || index < 0) {
        throw new Error('Invalid index');
    }
    var result = {};
    result['byte'] = Math.floor(index / 8);
    result['bit'] = index % 8;
    result['bitValue'] = Math.pow(2, (index % 8));
    return result;
}

Float.prototype.renderBit = function(index, value) {
    var bitSpan = this.elem.querySelector("#bit" + index);
    var classes = bitSpan.className;
    if(value){
        if(classes.indexOf('floatSelected') === -1){
            classes += ' floatSelected';
        }
    } else {
        classes = classes.replace(' floatSelected', '');
    }
    bitSpan.className = classes;
}

window.addEventListener("DOMContentLoaded", ready);

function ready(){
    var NumValues = {
        '+0': 0,
        '-0': -0,
        '+Inf': +Infinity,
        '-Inf': -Infinity,
        'NaN': NaN
    };

    var div = document.getElementById('floatBox');
    var floatText = document.getElementById('floatText');
    var x = new Float(div);

    var value = 1;
    for(var pow = 1; pow < 1075; pow++ ){
        value = value * 0.5;
        if(pow === 1022){
            NumValues['Min norm'] = value;
        }
        if(pow === 1074){
            NumValues['Min denorm'] = value;          
        }
    }

    x.setNum(0);
    var index;
    for(index = 0; index < 52; index ++ ){
        if(index != 52) {
            x.setBit(index, true)
        }
    }
    NumValues['Max denorm'] = x.getNum();

    for(index = 53; index < 63; index ++ ){
        x.setBit(index, true)
    }
    NumValues['Max norm'] = x.getNum();

    var valButtons = document.getElementById('valueButtons');
    for(var val in NumValues){
        var btn = document.createElement('BUTTON');
        btn.textContent = val;
        valButtons.appendChild(btn);
    }

    x.onValueChanged = function(value) {
        floatText.value = "" + value;
    };
    x.setNum(+(floatText.value));
    floatText.onchange = function(elem) {
        x.setNum(+(elem.target.value));
    };

    valButtons.addEventListener('click', function(evt) {
        var elem = evt.target;
        if(elem.nodeName !== 'BUTTON') return;
        var text = elem.textContent;
        var val = NumValues[text];
        x.setNum(val);
    });
}