<script lang="ts">
  import { onMount } from 'svelte';

  interface Props {
    windowId?: string;
  }

  let { windowId }: Props = $props();

  let expression = $state('');
  let current = $state('0');
  let previous = $state('');
  let operator = $state<string | null>(null);
  let resetNext = $state(false);

  function inputDigit(d: string) {
    if (resetNext) {
      current = d;
      resetNext = false;
    } else {
      current = current === '0' ? d : current + d;
    }
  }

  function inputDot() {
    if (resetNext) {
      current = '0.';
      resetNext = false;
    } else if (!current.includes('.')) {
      current += '.';
    }
  }

  function setOperator(op: string) {
    if (operator && !resetNext) calculate();
    previous = current;
    operator = op;
    resetNext = true;
  }

  function calculate() {
    if (!operator || !previous) return;
    const a = parseFloat(previous);
    const b = parseFloat(current);
    let result: number | 'Error';
    switch (operator) {
      case '+':
        result = a + b;
        break;
      case '-':
        result = a - b;
        break;
      case '*':
        result = a * b;
        break;
      case '/':
        result = b === 0 ? 'Error' : a / b;
        break;
      default:
        return;
    }
    current = result === 'Error' ? 'Error' : String(parseFloat(result.toFixed(10)));
    previous = '';
    operator = null;
    resetNext = true;
  }

  function clear() {
    current = '0';
    previous = '';
    operator = null;
    resetNext = false;
  }

  function onButton(action: string, val?: string, op?: string) {
    if (current === 'Error' && action !== 'clear') return;
    switch (action) {
      case 'digit':
        if (val) inputDigit(val);
        break;
      case 'dot':
        inputDot();
        break;
      case 'op':
        if (op) setOperator(op);
        break;
      case 'equals':
        calculate();
        break;
      case 'clear':
        clear();
        break;
      case 'negate':
        current = String(parseFloat(current) * -1);
        break;
      case 'percent':
        current = String(parseFloat(current) / 100);
        break;
    }
  }

  $effect(() => {
    expression = previous && operator ? `${previous} ${operator}` : '';
  });

  function onKeydown(e: KeyboardEvent) {
    if (e.key >= '0' && e.key <= '9') inputDigit(e.key);
    else if (e.key === '.') inputDot();
    else if (e.key === '+') setOperator('+');
    else if (e.key === '-') setOperator('-');
    else if (e.key === '*') setOperator('*');
    else if (e.key === '/') {
      e.preventDefault();
      setOperator('/');
    } else if (e.key === 'Enter' || e.key === '=') calculate();
    else if (e.key === 'Escape') clear();
    else if (e.key === 'Backspace') {
      current = current.length > 1 ? current.slice(0, -1) : '0';
    }
  }

  onMount(() => {
    window.addEventListener('keydown', onKeydown);
    return () => window.removeEventListener('keydown', onKeydown);
  });
</script>

<div class="calc-app">
  <div class="calc-display">
    <div class="calc-expression">{expression}</div>
    <div class="calc-result">{current}</div>
  </div>
  <div class="calc-buttons">
    <button class="calc-btn clear" onclick={() => onButton('clear')}>C</button>
    <button class="calc-btn" onclick={() => onButton('negate')}>±</button>
    <button class="calc-btn" onclick={() => onButton('percent')}>%</button>
    <button class="calc-btn operator" onclick={() => onButton('op', undefined, '/')}>÷</button>
    <button class="calc-btn" onclick={() => onButton('digit', '7')}>7</button>
    <button class="calc-btn" onclick={() => onButton('digit', '8')}>8</button>
    <button class="calc-btn" onclick={() => onButton('digit', '9')}>9</button>
    <button class="calc-btn operator" onclick={() => onButton('op', undefined, '*')}>×</button>
    <button class="calc-btn" onclick={() => onButton('digit', '4')}>4</button>
    <button class="calc-btn" onclick={() => onButton('digit', '5')}>5</button>
    <button class="calc-btn" onclick={() => onButton('digit', '6')}>6</button>
    <button class="calc-btn operator" onclick={() => onButton('op', undefined, '-')}>−</button>
    <button class="calc-btn" onclick={() => onButton('digit', '1')}>1</button>
    <button class="calc-btn" onclick={() => onButton('digit', '2')}>2</button>
    <button class="calc-btn" onclick={() => onButton('digit', '3')}>3</button>
    <button class="calc-btn operator" onclick={() => onButton('op', undefined, '+')}>+</button>
    <button class="calc-btn calc-zero" onclick={() => onButton('digit', '0')}>0</button>
    <button class="calc-btn" onclick={() => onButton('dot')}>.</button>
    <button class="calc-btn equals" onclick={() => onButton('equals')}>=</button>
  </div>
</div>
