import test from 'node:test';
import assert from 'node:assert/strict';
import {runExample,compareResult} from '../src/services/runner.js';
const load=async id=>(await import(`../src/data/solutions/${id}.json`,{with:{type:'json'}})).default;

test('cycle adapters connect tail to pos and compare the returned node by identity',async()=>{
  const codes={java:'class Solution {public ListNode detectCycle(ListNode head){Set<ListNode> seen=new HashSet<>();while(head!=null){if(!seen.add(head))return head;head=head.next;}return null;}}',python:'class Solution:\n    def detectCycle(self, head):\n        seen = set()\n        while head:\n            if head in seen: return head\n            seen.add(head)\n            head = head.next\n        return None'};
  const func={className:'Solution',methodName:'detectCycle',params:[{name:'head',type:'ListNode'}],returns:'ListNode',compare:'identity'};
  for(const language of ['java','python']){
    const r=await runExample({language,mode:'function',func,code:codes[language],cases:[{id:'cycle',input:{head:[3,2,2,4],pos:2},expected:{id:'head:2'}},{id:'no-cycle',input:{head:[1],pos:-1},expected:{id:null}}]});
    assert.equal(r.status,'passed',`${language}: ${JSON.stringify(r)}`);
  }
});

test('intersection adapters share the same suffix objects rather than matching node values',async()=>{
  const s=await load('160');
  for(const language of ['java','python']){
    const r=await runExample({language,mode:'function',func:s.func,code:s[language],cases:[{id:'shared',input:{intersectVal:8,listA:[4,1,8,4,5],listB:[5,6,1,8,4,5],skipA:2,skipB:3},expected:{id:'listA:2'}},{id:'equal-values',input:{intersectVal:0,listA:[1,2],listB:[1,2],skipA:2,skipB:2},expected:{id:null}}]});
    assert.equal(r.status,'passed',`${language}: ${JSON.stringify(r)}`);
  }
});

test('random-list adapter verifies that a copy has no references to original nodes',async()=>{
  const s=await load('138');const func={...s.func,compare:'exact'};
  const input={head:[[7,null],[13,0],[7,1]]};const expected={nodes:[[7,null],[13,0],[7,1]],independent:true};
  for(const language of ['java','python']){
    const r=await runExample({language,mode:'function',func,code:s[language],cases:[{id:'deep',input,expected}]});
    assert.equal(r.status,'passed',`${language}: ${JSON.stringify(r)}`);
    const code=language==='java'?'class Solution {public Node copyRandomList(Node head){return head;}}':'class Solution:\n    def copyRandomList(self, head): return head';
    const wrong=await runExample({language,mode:'function',func,code,cases:[{id:'shallow',input,expected}]});
    assert.equal(wrong.cases[0].status,'mismatch');
  }
});

test('TreeNode scalar parameters refer to nodes from the root graph',async()=>{
  const s=await load('236');const func={...s.func,compare:'identity'};
  for(const language of ['java','python']){
    const r=await runExample({language,mode:'function',func,code:s[language],cases:[{id:'lca',input:{root:[3,5,1,6,2,0,8,null,null,7,4],p:5,q:1},expected:{id:'root:0'}}]});
    assert.equal(r.status,'passed',`${language}: ${JSON.stringify(r)}`);
  }
});

test('any-valid checks balanced BST structure instead of accepting an arbitrary valid flag',async()=>{
  const s=await load('108');
  for(const language of ['java','python']){
    const r=await runExample({language,mode:'function',func:s.func,code:s[language],cases:[{id:'balanced',input:{nums:[-10,-3,0,5,9]},expected:[0,-3,9,-10,null,5]}]});
    assert.equal(r.status,'passed',`${language}: ${JSON.stringify(r)}`);
  }
  const wrong=await runExample({language:'python',mode:'function',func:s.func,code:'class Solution:\n    def sortedArrayToBST(self, nums): return TreeNode(99)',cases:[{id:'invalid',input:{nums:[-1,0,1]},expected:[0,-1,1]}]});
  assert.equal(wrong.cases[0].status,'mismatch');
});

test('longest palindrome accepts both valid longest answers and rejects short palindromes',async()=>{
  const s=await load('5');const func={...s.func,compare:'any-valid'};
  const r=await runExample({language:'python',mode:'function',func,code:s.python,cases:[{id:'tie',input:{s:'babad'},expected:'bab'}]});assert.equal(r.status,'passed',JSON.stringify(r));
  const wrong=await runExample({language:'python',mode:'function',func,code:'class Solution:\n    def longestPalindrome(self, s): return "b"',cases:[{id:'short',input:{s:'babad'},expected:'bab'}]});assert.equal(wrong.cases[0].status,'mismatch');
});

test('unordered-nested rejects scalar values and exact comparisons retain null',async()=>{
  assert.equal(compareResult('unordered-nested',true,true).passed,false);
  const r=await runExample({language:'python',mode:'function',func:{className:'Solution',methodName:'value',params:[],returns:'Object',compare:'exact'},code:'class Solution:\n    def value(self): return None',cases:[{id:'null',input:{},expected:null}]});assert.equal(r.status,'passed',JSON.stringify(r));
});
