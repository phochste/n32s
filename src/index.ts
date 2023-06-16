#!/usr/bin/env node

import * as N3 from 'n3';
import { parseN3File, makeGraph, writeGraph, writeDynamic } from './parser';

if (process.argv.length != 3) {
    console.log(`usage: ${process.argv[1]} n3-file`);
    process.exit(1);
}

const input = process.argv[2];

const knownPredicates = [
    'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
    'http://www.w3.org/2000/10/swap/log#onNegativeSurface',
    'http://www.w3.org/2000/10/swap/log#onPositiveSurface',
    'http://www.w3.org/2000/10/swap/log#onNeutralSurface',
    'http://www.w3.org/2000/10/swap/log#onQuerySurface',
    'http://www.w3.org/2000/10/swap/log#negativeTriple'
];

main(input);

async function main(path: string) : Promise<void> {
    const store = await parseN3File(path);
    const graph = makeGraph(store);
    const dynamic = writeDynamic(graph, knownPredicates);
    const n3s = writeGraph(graph);
    if (dynamic.length) {
        console.log(dynamic);
    }
    console.log(n3s);
}