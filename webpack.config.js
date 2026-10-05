const path = require('node:path');

module.exports = (_env, argv) => {
    const isProduction = (argv && argv.mode) === 'production';
    return {
        entry: './src/client/js/app.ts',
        mode: isProduction ? 'production' : 'development',
        resolve: {
            extensions: ['.ts', '.js']
        },
        output: {
            path: path.resolve(__dirname, 'bin/client/js'),
            library: 'app',
            filename: 'app.js'
        },
        devtool: false,
        module: {
            rules: [{
                test: /\.ts$/,
                exclude: /node_modules/,
                use: {
                    loader: 'ts-loader',
                    options: {
                        configFile: 'tsconfig.client.json',
                        transpileOnly: !isProduction
                    }
                }
            }]
        }
    };
};
