
(function(l, r) { if (!l || l.getElementById('livereloadscript')) return; r = l.createElement('script'); r.async = 1; r.src = '//' + (self.location.host || 'localhost').split(':')[0] + ':35729/livereload.js?snipver=1'; r.id = 'livereloadscript'; l.getElementsByTagName('head')[0].appendChild(r) })(self.document);
var app = (function () {
    'use strict';

    function noop() { }
    function run(fn) {
        return fn();
    }
    function blank_object() {
        return Object.create(null);
    }
    function run_all(fns) {
        fns.forEach(run);
    }
    function is_function(thing) {
        return typeof thing === 'function';
    }
    function safe_not_equal(a, b) {
        return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
    }
    function is_empty(obj) {
        return Object.keys(obj).length === 0;
    }

    // Track which nodes are claimed during hydration. Unclaimed nodes can then be removed from the DOM
    // at the end of hydration without touching the remaining nodes.
    let is_hydrating = false;
    function start_hydrating() {
        is_hydrating = true;
    }
    function end_hydrating() {
        is_hydrating = false;
    }
    function upper_bound(low, high, key, value) {
        // Return first index of value larger than input value in the range [low, high)
        while (low < high) {
            const mid = low + ((high - low) >> 1);
            if (key(mid) <= value) {
                low = mid + 1;
            }
            else {
                high = mid;
            }
        }
        return low;
    }
    function init_hydrate(target) {
        if (target.hydrate_init)
            return;
        target.hydrate_init = true;
        // We know that all children have claim_order values since the unclaimed have been detached
        const children = target.childNodes;
        /*
        * Reorder claimed children optimally.
        * We can reorder claimed children optimally by finding the longest subsequence of
        * nodes that are already claimed in order and only moving the rest. The longest
        * subsequence subsequence of nodes that are claimed in order can be found by
        * computing the longest increasing subsequence of .claim_order values.
        *
        * This algorithm is optimal in generating the least amount of reorder operations
        * possible.
        *
        * Proof:
        * We know that, given a set of reordering operations, the nodes that do not move
        * always form an increasing subsequence, since they do not move among each other
        * meaning that they must be already ordered among each other. Thus, the maximal
        * set of nodes that do not move form a longest increasing subsequence.
        */
        // Compute longest increasing subsequence
        // m: subsequence length j => index k of smallest value that ends an increasing subsequence of length j
        const m = new Int32Array(children.length + 1);
        // Predecessor indices + 1
        const p = new Int32Array(children.length);
        m[0] = -1;
        let longest = 0;
        for (let i = 0; i < children.length; i++) {
            const current = children[i].claim_order;
            // Find the largest subsequence length such that it ends in a value less than our current value
            // upper_bound returns first greater value, so we subtract one
            const seqLen = upper_bound(1, longest + 1, idx => children[m[idx]].claim_order, current) - 1;
            p[i] = m[seqLen] + 1;
            const newLen = seqLen + 1;
            // We can guarantee that current is the smallest value. Otherwise, we would have generated a longer sequence.
            m[newLen] = i;
            longest = Math.max(newLen, longest);
        }
        // The longest increasing subsequence of nodes (initially reversed)
        const lis = [];
        // The rest of the nodes, nodes that will be moved
        const toMove = [];
        let last = children.length - 1;
        for (let cur = m[longest] + 1; cur != 0; cur = p[cur - 1]) {
            lis.push(children[cur - 1]);
            for (; last >= cur; last--) {
                toMove.push(children[last]);
            }
            last--;
        }
        for (; last >= 0; last--) {
            toMove.push(children[last]);
        }
        lis.reverse();
        // We sort the nodes being moved to guarantee that their insertion order matches the claim order
        toMove.sort((a, b) => a.claim_order - b.claim_order);
        // Finally, we move the nodes
        for (let i = 0, j = 0; i < toMove.length; i++) {
            while (j < lis.length && toMove[i].claim_order >= lis[j].claim_order) {
                j++;
            }
            const anchor = j < lis.length ? lis[j] : null;
            target.insertBefore(toMove[i], anchor);
        }
    }
    function append(target, node) {
        if (is_hydrating) {
            init_hydrate(target);
            if ((target.actual_end_child === undefined) || ((target.actual_end_child !== null) && (target.actual_end_child.parentElement !== target))) {
                target.actual_end_child = target.firstChild;
            }
            if (node !== target.actual_end_child) {
                target.insertBefore(node, target.actual_end_child);
            }
            else {
                target.actual_end_child = node.nextSibling;
            }
        }
        else if (node.parentNode !== target) {
            target.appendChild(node);
        }
    }
    function insert(target, node, anchor) {
        if (is_hydrating && !anchor) {
            append(target, node);
        }
        else if (node.parentNode !== target || (anchor && node.nextSibling !== anchor)) {
            target.insertBefore(node, anchor || null);
        }
    }
    function detach(node) {
        node.parentNode.removeChild(node);
    }
    function element(name) {
        return document.createElement(name);
    }
    function text(data) {
        return document.createTextNode(data);
    }
    function space() {
        return text(' ');
    }
    function listen(node, event, handler, options) {
        node.addEventListener(event, handler, options);
        return () => node.removeEventListener(event, handler, options);
    }
    function attr(node, attribute, value) {
        if (value == null)
            node.removeAttribute(attribute);
        else if (node.getAttribute(attribute) !== value)
            node.setAttribute(attribute, value);
    }
    function children(element) {
        return Array.from(element.childNodes);
    }
    function set_data(text, data) {
        data = '' + data;
        if (text.wholeText !== data)
            text.data = data;
    }
    function set_input_value(input, value) {
        input.value = value == null ? '' : value;
    }

    let current_component;
    function set_current_component(component) {
        current_component = component;
    }

    const dirty_components = [];
    const binding_callbacks = [];
    const render_callbacks = [];
    const flush_callbacks = [];
    const resolved_promise = Promise.resolve();
    let update_scheduled = false;
    function schedule_update() {
        if (!update_scheduled) {
            update_scheduled = true;
            resolved_promise.then(flush);
        }
    }
    function add_render_callback(fn) {
        render_callbacks.push(fn);
    }
    let flushing = false;
    const seen_callbacks = new Set();
    function flush() {
        if (flushing)
            return;
        flushing = true;
        do {
            // first, call beforeUpdate functions
            // and update components
            for (let i = 0; i < dirty_components.length; i += 1) {
                const component = dirty_components[i];
                set_current_component(component);
                update(component.$$);
            }
            set_current_component(null);
            dirty_components.length = 0;
            while (binding_callbacks.length)
                binding_callbacks.pop()();
            // then, once components are updated, call
            // afterUpdate functions. This may cause
            // subsequent updates...
            for (let i = 0; i < render_callbacks.length; i += 1) {
                const callback = render_callbacks[i];
                if (!seen_callbacks.has(callback)) {
                    // ...so guard against infinite loops
                    seen_callbacks.add(callback);
                    callback();
                }
            }
            render_callbacks.length = 0;
        } while (dirty_components.length);
        while (flush_callbacks.length) {
            flush_callbacks.pop()();
        }
        update_scheduled = false;
        flushing = false;
        seen_callbacks.clear();
    }
    function update($$) {
        if ($$.fragment !== null) {
            $$.update();
            run_all($$.before_update);
            const dirty = $$.dirty;
            $$.dirty = [-1];
            $$.fragment && $$.fragment.p($$.ctx, dirty);
            $$.after_update.forEach(add_render_callback);
        }
    }
    const outroing = new Set();
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
    }
    function mount_component(component, target, anchor, customElement) {
        const { fragment, on_mount, on_destroy, after_update } = component.$$;
        fragment && fragment.m(target, anchor);
        if (!customElement) {
            // onMount happens before the initial afterUpdate
            add_render_callback(() => {
                const new_on_destroy = on_mount.map(run).filter(is_function);
                if (on_destroy) {
                    on_destroy.push(...new_on_destroy);
                }
                else {
                    // Edge case - component was destroyed immediately,
                    // most likely as a result of a binding initialising
                    run_all(new_on_destroy);
                }
                component.$$.on_mount = [];
            });
        }
        after_update.forEach(add_render_callback);
    }
    function destroy_component(component, detaching) {
        const $$ = component.$$;
        if ($$.fragment !== null) {
            run_all($$.on_destroy);
            $$.fragment && $$.fragment.d(detaching);
            // TODO null out other refs, including component.$$ (but need to
            // preserve final state?)
            $$.on_destroy = $$.fragment = null;
            $$.ctx = [];
        }
    }
    function make_dirty(component, i) {
        if (component.$$.dirty[0] === -1) {
            dirty_components.push(component);
            schedule_update();
            component.$$.dirty.fill(0);
        }
        component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
    }
    function init(component, options, instance, create_fragment, not_equal, props, dirty = [-1]) {
        const parent_component = current_component;
        set_current_component(component);
        const $$ = component.$$ = {
            fragment: null,
            ctx: null,
            // state
            props,
            update: noop,
            not_equal,
            bound: blank_object(),
            // lifecycle
            on_mount: [],
            on_destroy: [],
            on_disconnect: [],
            before_update: [],
            after_update: [],
            context: new Map(parent_component ? parent_component.$$.context : options.context || []),
            // everything else
            callbacks: blank_object(),
            dirty,
            skip_bound: false
        };
        let ready = false;
        $$.ctx = instance
            ? instance(component, options.props || {}, (i, ret, ...rest) => {
                const value = rest.length ? rest[0] : ret;
                if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                    if (!$$.skip_bound && $$.bound[i])
                        $$.bound[i](value);
                    if (ready)
                        make_dirty(component, i);
                }
                return ret;
            })
            : [];
        $$.update();
        ready = true;
        run_all($$.before_update);
        // `false` as a special case of no DOM component
        $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
        if (options.target) {
            if (options.hydrate) {
                start_hydrating();
                const nodes = children(options.target);
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.l(nodes);
                nodes.forEach(detach);
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.c();
            }
            if (options.intro)
                transition_in(component.$$.fragment);
            mount_component(component, options.target, options.anchor, options.customElement);
            end_hydrating();
            flush();
        }
        set_current_component(parent_component);
    }
    /**
     * Base class for Svelte components. Used when dev=false.
     */
    class SvelteComponent {
        $destroy() {
            destroy_component(this, 1);
            this.$destroy = noop;
        }
        $on(type, callback) {
            const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
            callbacks.push(callback);
            return () => {
                const index = callbacks.indexOf(callback);
                if (index !== -1)
                    callbacks.splice(index, 1);
            };
        }
        $set($$props) {
            if (this.$$set && !is_empty($$props)) {
                this.$$.skip_bound = true;
                this.$$set($$props);
                this.$$.skip_bound = false;
            }
        }
    }

    /* src\App.svelte generated by Svelte v3.38.3 */

    function create_fragment(ctx) {
    	let main;
    	let article0;
    	let h1;
    	let t1;
    	let dl0;
    	let dt0;
    	let dd0;
    	let input0;
    	let span0;
    	let t4;
    	let dt1;
    	let dd1;
    	let input1;
    	let span1;
    	let t7;
    	let dt2;
    	let dd2;
    	let input2;
    	let span2;
    	let t10;
    	let dt3;
    	let dd3;
    	let input3;
    	let span3;
    	let t13;
    	let dt4;
    	let dd4;
    	let input4;
    	let span4;
    	let t16;
    	let article1;
    	let dl1;
    	let dt5;
    	let dd5;
    	let t18_value = /*dependents*/ ctx[5].toLocaleString() + "";
    	let t18;
    	let t19;
    	let span5;
    	let dt6;
    	let dd6;
    	let t22_value = /*found_cost*/ ctx[7].toLocaleString() + "";
    	let t22;
    	let t23;
    	let span6;
    	let dt7;
    	let dd7;
    	let t26_value = /*result*/ ctx[6].toLocaleString() + "";
    	let t26;
    	let t27;
    	let span7;
    	let dt8;
    	let dd8;
    	let t30_value = /*afterTax*/ ctx[8].toLocaleString() + "";
    	let t30;
    	let t31;
    	let span8;
    	let dt9;
    	let dd9;
    	let t34_value = /*single_interest*/ ctx[9].toLocaleString() + "";
    	let t34;
    	let t35;
    	let span9;
    	let dt10;
    	let dd10;
    	let t38_value = /*three_interest*/ ctx[10].toLocaleString() + "";
    	let t38;
    	let t39;
    	let span10;
    	let dt11;
    	let dd11;
    	let t42_value = /*five_interest*/ ctx[11].toLocaleString() + "";
    	let t42;
    	let t43;
    	let span11;
    	let dt12;
    	let dd12;
    	let t46_value = /*ten_interest*/ ctx[12].toLocaleString() + "";
    	let t46;
    	let t47;
    	let span12;
    	let mounted;
    	let dispose;

    	return {
    		c() {
    			main = element("main");
    			article0 = element("article");
    			h1 = element("h1");
    			h1.textContent = "投資信託分配金";
    			t1 = space();
    			dl0 = element("dl");
    			dt0 = element("dt");
    			dt0.textContent = "購入金額";
    			dd0 = element("dd");
    			input0 = element("input");
    			span0 = element("span");
    			span0.textContent = "万円";
    			t4 = space();
    			dt1 = element("dt");
    			dt1.textContent = "購入時基準価格";
    			dd1 = element("dd");
    			input1 = element("input");
    			span1 = element("span");
    			span1.textContent = "円";
    			t7 = space();
    			dt2 = element("dt");
    			dt2.textContent = "信託手数料";
    			dd2 = element("dd");
    			input2 = element("input");
    			span2 = element("span");
    			span2.textContent = "％";
    			t10 = space();
    			dt3 = element("dt");
    			dt3.textContent = "分配金(年)";
    			dd3 = element("dd");
    			input3 = element("input");
    			span3 = element("span");
    			span3.textContent = "円";
    			t13 = space();
    			dt4 = element("dt");
    			dt4.textContent = "基準価格上昇率(年)";
    			dd4 = element("dd");
    			input4 = element("input");
    			span4 = element("span");
    			span4.textContent = "％";
    			t16 = space();
    			article1 = element("article");
    			dl1 = element("dl");
    			dt5 = element("dt");
    			dt5.textContent = "約定口数";
    			dd5 = element("dd");
    			t18 = text(t18_value);
    			t19 = text(" ");
    			span5 = element("span");
    			span5.textContent = "口";
    			dt6 = element("dt");
    			dt6.textContent = "信託手数料";
    			dd6 = element("dd");
    			t22 = text(t22_value);
    			t23 = text(" ");
    			span6 = element("span");
    			span6.textContent = "円/年";
    			dt7 = element("dt");
    			dt7.textContent = "受取分配金";
    			dd7 = element("dd");
    			t26 = text(t26_value);
    			t27 = text(" ");
    			span7 = element("span");
    			span7.textContent = "円";
    			dt8 = element("dt");
    			dt8.textContent = "税引き後";
    			dd8 = element("dd");
    			t30 = text(t30_value);
    			t31 = text(" ");
    			span8 = element("span");
    			span8.textContent = "円";
    			dt9 = element("dt");
    			dt9.textContent = "単年利周り";
    			dd9 = element("dd");
    			t34 = text(t34_value);
    			t35 = text(" ");
    			span9 = element("span");
    			span9.textContent = "円";
    			dt10 = element("dt");
    			dt10.textContent = "3年複利";
    			dd10 = element("dd");
    			t38 = text(t38_value);
    			t39 = text(" ");
    			span10 = element("span");
    			span10.textContent = "円";
    			dt11 = element("dt");
    			dt11.textContent = "5年複利";
    			dd11 = element("dd");
    			t42 = text(t42_value);
    			t43 = text(" ");
    			span11 = element("span");
    			span11.textContent = "円";
    			dt12 = element("dt");
    			dt12.textContent = "10年複利";
    			dd12 = element("dd");
    			t46 = text(t46_value);
    			t47 = text(" ");
    			span12 = element("span");
    			span12.textContent = "円";
    			attr(input0, "type", "text");
    			attr(input0, "size", "6");
    			attr(input1, "type", "text");
    			attr(input1, "size", "6");
    			attr(input2, "type", "text");
    			attr(input2, "size", "4");
    			attr(input3, "type", "text");
    			attr(input3, "size", "6");
    			attr(input4, "type", "text");
    			attr(input4, "size", "3");
    		},
    		m(target, anchor) {
    			insert(target, main, anchor);
    			append(main, article0);
    			append(article0, h1);
    			append(article0, t1);
    			append(article0, dl0);
    			append(dl0, dt0);
    			append(dl0, dd0);
    			append(dd0, input0);
    			set_input_value(input0, /*purchase_price*/ ctx[0]);
    			append(dd0, span0);
    			append(dd0, t4);
    			append(dl0, dt1);
    			append(dl0, dd1);
    			append(dd1, input1);
    			set_input_value(input1, /*base_price*/ ctx[1]);
    			append(dd1, span1);
    			append(dd1, t7);
    			append(dl0, dt2);
    			append(dl0, dd2);
    			append(dd2, input2);
    			set_input_value(input2, /*found_fee*/ ctx[3]);
    			append(dd2, span2);
    			append(dd2, t10);
    			append(dl0, dt3);
    			append(dl0, dd3);
    			append(dd3, input3);
    			set_input_value(input3, /*distribution*/ ctx[2]);
    			append(dd3, span3);
    			append(dd3, t13);
    			append(dl0, dt4);
    			append(dl0, dd4);
    			append(dd4, input4);
    			set_input_value(input4, /*interest*/ ctx[4]);
    			append(dd4, span4);
    			append(main, t16);
    			append(main, article1);
    			append(article1, dl1);
    			append(dl1, dt5);
    			append(dl1, dd5);
    			append(dd5, t18);
    			append(dd5, t19);
    			append(dd5, span5);
    			append(dl1, dt6);
    			append(dl1, dd6);
    			append(dd6, t22);
    			append(dd6, t23);
    			append(dd6, span6);
    			append(dl1, dt7);
    			append(dl1, dd7);
    			append(dd7, t26);
    			append(dd7, t27);
    			append(dd7, span7);
    			append(dl1, dt8);
    			append(dl1, dd8);
    			append(dd8, t30);
    			append(dd8, t31);
    			append(dd8, span8);
    			append(dl1, dt9);
    			append(dl1, dd9);
    			append(dd9, t34);
    			append(dd9, t35);
    			append(dd9, span9);
    			append(dl1, dt10);
    			append(dl1, dd10);
    			append(dd10, t38);
    			append(dd10, t39);
    			append(dd10, span10);
    			append(dl1, dt11);
    			append(dl1, dd11);
    			append(dd11, t42);
    			append(dd11, t43);
    			append(dd11, span11);
    			append(dl1, dt12);
    			append(dl1, dd12);
    			append(dd12, t46);
    			append(dd12, t47);
    			append(dd12, span12);

    			if (!mounted) {
    				dispose = [
    					listen(input0, "input", /*input0_input_handler*/ ctx[15]),
    					listen(input1, "input", /*input1_input_handler*/ ctx[16]),
    					listen(input2, "input", /*input2_input_handler*/ ctx[17]),
    					listen(input3, "input", /*input3_input_handler*/ ctx[18]),
    					listen(input4, "input", /*input4_input_handler*/ ctx[19])
    				];

    				mounted = true;
    			}
    		},
    		p(ctx, [dirty]) {
    			if (dirty & /*purchase_price*/ 1 && input0.value !== /*purchase_price*/ ctx[0]) {
    				set_input_value(input0, /*purchase_price*/ ctx[0]);
    			}

    			if (dirty & /*base_price*/ 2 && input1.value !== /*base_price*/ ctx[1]) {
    				set_input_value(input1, /*base_price*/ ctx[1]);
    			}

    			if (dirty & /*found_fee*/ 8 && input2.value !== /*found_fee*/ ctx[3]) {
    				set_input_value(input2, /*found_fee*/ ctx[3]);
    			}

    			if (dirty & /*distribution*/ 4 && input3.value !== /*distribution*/ ctx[2]) {
    				set_input_value(input3, /*distribution*/ ctx[2]);
    			}

    			if (dirty & /*interest*/ 16 && input4.value !== /*interest*/ ctx[4]) {
    				set_input_value(input4, /*interest*/ ctx[4]);
    			}

    			if (dirty & /*dependents*/ 32 && t18_value !== (t18_value = /*dependents*/ ctx[5].toLocaleString() + "")) set_data(t18, t18_value);
    			if (dirty & /*found_cost*/ 128 && t22_value !== (t22_value = /*found_cost*/ ctx[7].toLocaleString() + "")) set_data(t22, t22_value);
    			if (dirty & /*result*/ 64 && t26_value !== (t26_value = /*result*/ ctx[6].toLocaleString() + "")) set_data(t26, t26_value);
    			if (dirty & /*afterTax*/ 256 && t30_value !== (t30_value = /*afterTax*/ ctx[8].toLocaleString() + "")) set_data(t30, t30_value);
    			if (dirty & /*single_interest*/ 512 && t34_value !== (t34_value = /*single_interest*/ ctx[9].toLocaleString() + "")) set_data(t34, t34_value);
    			if (dirty & /*three_interest*/ 1024 && t38_value !== (t38_value = /*three_interest*/ ctx[10].toLocaleString() + "")) set_data(t38, t38_value);
    			if (dirty & /*five_interest*/ 2048 && t42_value !== (t42_value = /*five_interest*/ ctx[11].toLocaleString() + "")) set_data(t42, t42_value);
    			if (dirty & /*ten_interest*/ 4096 && t46_value !== (t46_value = /*ten_interest*/ ctx[12].toLocaleString() + "")) set_data(t46, t46_value);
    		},
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(main);
    			mounted = false;
    			run_all(dispose);
    		}
    	};
    }

    const TAX = 20.315; // 税金
    const DIGIT = 10000; // 万円表示用の係数

    function instance($$self, $$props, $$invalidate) {
    	let _purchase_price;
    	let _interest;
    	let dependents;
    	let found_cost;
    	let result;
    	let afterTax;
    	let single_interest;
    	let three_interest;
    	let five_interest;
    	let ten_interest;
    	const TAX_COEFFICIENT = (100 - TAX) / 100; // 税金係数
    	let purchase_price = 100; // 購入金額
    	let base_price = 10000; // 購入時基準価格
    	let distribution = 100; // 分配金
    	let found_fee = 0.0938; // 信託手数料
    	let interest = 5.3; // 年利回り

    	function input0_input_handler() {
    		purchase_price = this.value;
    		$$invalidate(0, purchase_price);
    	}

    	function input1_input_handler() {
    		base_price = this.value;
    		$$invalidate(1, base_price);
    	}

    	function input2_input_handler() {
    		found_fee = this.value;
    		$$invalidate(3, found_fee);
    	}

    	function input3_input_handler() {
    		distribution = this.value;
    		$$invalidate(2, distribution);
    	}

    	function input4_input_handler() {
    		interest = this.value;
    		$$invalidate(4, interest);
    	}

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty & /*purchase_price*/ 1) {
    			$$invalidate(13, _purchase_price = purchase_price * DIGIT);
    		}

    		if ($$self.$$.dirty & /*interest*/ 16) {
    			$$invalidate(14, _interest = interest / 100 + 1);
    		}

    		if ($$self.$$.dirty & /*_purchase_price, base_price*/ 8194) {
    			$$invalidate(5, dependents = Math.ceil(_purchase_price / base_price * 10000));
    		}

    		if ($$self.$$.dirty & /*_purchase_price, found_fee*/ 8200) {
    			$$invalidate(7, found_cost = Math.floor(_purchase_price * (found_fee / 100)));
    		}

    		if ($$self.$$.dirty & /*dependents, distribution*/ 36) {
    			$$invalidate(6, result = Math.floor(dependents * distribution / 10000));
    		}

    		if ($$self.$$.dirty & /*result*/ 64) {
    			$$invalidate(8, afterTax = Math.floor(result * TAX_COEFFICIENT));
    		}

    		if ($$self.$$.dirty & /*_purchase_price, _interest*/ 24576) {
    			$$invalidate(9, single_interest = Math.floor(_purchase_price * _interest));
    		}

    		if ($$self.$$.dirty & /*_purchase_price, _interest*/ 24576) {
    			$$invalidate(10, three_interest = Math.floor(_purchase_price * Math.pow(_interest, 3)));
    		}

    		if ($$self.$$.dirty & /*_purchase_price, _interest*/ 24576) {
    			$$invalidate(11, five_interest = Math.floor(_purchase_price * Math.pow(_interest, 5)));
    		}

    		if ($$self.$$.dirty & /*_purchase_price, _interest*/ 24576) {
    			$$invalidate(12, ten_interest = Math.floor(_purchase_price * Math.pow(_interest, 10)));
    		}
    	};

    	return [
    		purchase_price,
    		base_price,
    		distribution,
    		found_fee,
    		interest,
    		dependents,
    		result,
    		found_cost,
    		afterTax,
    		single_interest,
    		three_interest,
    		five_interest,
    		ten_interest,
    		_purchase_price,
    		_interest,
    		input0_input_handler,
    		input1_input_handler,
    		input2_input_handler,
    		input3_input_handler,
    		input4_input_handler
    	];
    }

    class App extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance, create_fragment, safe_not_equal, {});
    	}
    }

    const app = new App({
        target: document.body,
        props: {
            name: 'world'
        }
    });

    return app;

}());
